# InboxMessage — `InboxMessageAggregate`

OLD_README §6.5 e §10. Convenções gerais em @docs/domain/shared.md.

## Papel

**O registro de "esta mensagem do SQS já foi processada por este consumer".** O SQS entrega pelo menos uma vez: se o processo cair depois do commit e antes do ack, a mesma mensagem volta. A inbox é gravada **na mesma transação** da alteração financeira, então "processei" e "apliquei" são sempre verdade ao mesmo tempo. Quando a mensagem volta, o consumer encontra o registro e só dá o ack.

Ela é deduplicação de **transporte** (a mensagem). A idempotency key + `payloadHash` é deduplicação de **negócio** (a operação) e vale para HTTP e SQS. No caminho da fila, as duas se sobrepõem no caso de redelivery. Ver a explicação em `ARCHITECTURE.md`.

## Lugar no modelo: aggregate de um só

Cada registro da inbox tem ciclo de vida próprio (`receive` → `markProcessed`), não pertence a nenhum outro aggregate e é salvo sozinho pelo seu repository. Por isso é um **aggregate** (`Aggregate` do toolkit), formado só pelo root.

Não é um conceito de negócio. É um mecanismo técnico de mensageria, então fica no módulo `src/domain/messaging/`, separado de Wallet e WagerTransaction.

## Regras

- Única por `(consumerName, messageId)`. Quem garante é o banco (`UNIQUE`), não a classe. O registro é feito com `INSERT ... ON CONFLICT DO NOTHING`, e o resultado diz se a mensagem é nova.
- Persistente, nunca em memória.
- Gravada na mesma transação SQL do use case. Se o commit falhar, a inbox também some e a mensagem pode ser reprocessada.
- `payloadHash` guarda o hash do corpo recebido. Mesmo `messageId` com hash diferente é uma anomalia: logar e contar em métrica.
- `markProcessed` só pode ser chamado uma vez.
- `receivedAt` é o `createdAt` do `Aggregate` (o momento em que o registro nasceu).

## inbox-message.props.ts
```ts
import { DateValueObject, IBaseDomainAggregate } from "ddd-tool-kit";

/** createdAt (from Aggregate) is the moment the message was received. */
interface IInboxMessageProps extends IBaseDomainAggregate {
  messageId: string;    // SQS message id (external, any format)
  consumerName: string; // e.g. "wager-transactions-consumer"
  payloadHash: string;
  processedAt?: DateValueObject;
}

interface IReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
}

export { IInboxMessageProps, IReceiveInboxProps };
```

## inbox-message.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../../shared/domain-error";
import { FailureCode } from "../../shared/failure-code";

const INVALID_INBOX_MESSAGE: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Inbox message requires messageId, consumerName and payloadHash.",
  statusCode: HttpStatus.BAD_REQUEST,
};

/** Programming error: the message was already marked as processed. */
class InboxMessageAlreadyProcessedError extends Error {
  constructor(consumerName: string, messageId: string) {
    super(`Inbox message ${consumerName}/${messageId} is already processed.`);
    this.name = "InboxMessageAlreadyProcessedError";
  }
}

export { INVALID_INBOX_MESSAGE, InboxMessageAlreadyProcessedError };
```

## inbox-message.aggregate-root.ts
```ts
import {
  Aggregate,
  DateValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IInboxMessageProps, IReceiveInboxProps } from "./inbox-message.props";
import { INVALID_INBOX_MESSAGE, InboxMessageAlreadyProcessedError } from "./inbox-message.errors";

class InboxMessageAggregate extends Aggregate<IInboxMessageProps> {
  private constructor(props: IInboxMessageProps) {
    super(props);
  }

  get messageId() {
    return this.props.messageId;
  }

  get consumerName() {
    return this.props.consumerName;
  }

  get payloadHash() {
    return this.props.payloadHash;
  }

  get receivedAt() {
    return this.createdAt;
  }

  get processedAt() {
    return this.props.processedAt;
  }

  isProcessed(): boolean {
    return this.props.processedAt !== undefined;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.props.payloadHash === payloadHash;
  }

  markProcessed(at: DateValueObject): void {
    if (this.isProcessed()) {
      throw new InboxMessageAlreadyProcessedError(this.props.consumerName, this.props.messageId);
    }
    this.props.processedAt = at;
    this.props.updatedAt = at;
  }

  protected sanitizeProps(): void {
    this.props.messageId = this.props.messageId?.trim();
    this.props.consumerName = this.props.consumerName?.trim();
  }

  protected isValidProps(): boolean {
    const valueObjects = [...this.defaultValueObjects];
    const requiredProps = [...valueObjects, "messageId", "consumerName", "payloadHash"];

    return verifyAllPropsExists(requiredProps, this) && verifyAreValueObjects(valueObjects, this);
  }

  static receive(props: IReceiveInboxProps) {
    const message = new InboxMessageAggregate({ ...props });

    const isInvalidProps = !message.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_INBOX_MESSAGE);

    return Output.success(message);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IInboxMessageProps): InboxMessageAggregate {
    return new InboxMessageAggregate(props);
  }
}

export { InboxMessageAggregate };
```

## inbox-message.repository.ts (porta, application)
```ts
import { InboxMessageAggregate } from "../../domain/messaging/inbox-message/inbox-message.aggregate-root";

interface InboxMessageRepository {
  /** INSERT ... ON CONFLICT (consumer_name, message_id) DO NOTHING. true = new message. */
  tryRegister(message: InboxMessageAggregate): Promise<boolean>;
  /** Saves processed_at / updated_at. */
  save(message: InboxMessageAggregate): Promise<void>;
}

export { InboxMessageRepository };
```

## Uso no consumer SQS

```ts
async handle(message: SqsMessage): Promise<void> {
  const createInbox = InboxMessageAggregate.receive({
    messageId: message.MessageId,
    consumerName: WAGER_CONSUMER_NAME,
    payloadHash: hashBody(message.Body),
  });
  if (createInbox.isFailure) return this.sendToDlq(message); // permanent: malformed message

  const inbox = createInbox.result as InboxMessageAggregate;

  await this.uow.transactional(async () => {
    const isNew = await this.inboxRepository.tryRegister(inbox);
    if (!isNew) return;                                       // duplicate: only ack

    await this.submitWagerTransaction.execute(parsed.data);   // same use case as HTTP
    inbox.markProcessed(DateValueObject.getDefault());
    await this.inboxRepository.save(inbox);
  });                                                         // COMMIT: inbox + money together

  await this.sqs.deleteMessage(message);                      // ack only after commit
}
```

## Persistência

```sql
create table "inbox_messages" (
  "id"            char(16)    primary key,
  "message_id"    text        not null,
  "consumer_name" text        not null,
  "payload_hash"  char(64)    not null,
  "created_at"    timestamptz not null,  -- received at
  "updated_at"    timestamptz not null,
  "processed_at"  timestamptz,
  constraint "inbox_consumer_message_unique" unique ("consumer_name", "message_id")
);
```

O `id` existe porque todo aggregate do `ddd-tool-kit` tem um. A deduplicação vem do `UNIQUE (consumer_name, message_id)`.

## Testes

- Unitário: `receive` recusa campos vazios. `markProcessed` duas vezes lança erro. `matchesPayload`. `receivedAt` igual a `createdAt`.
- Integração (OLD_README §13): a mesma mensagem entregue duas vezes gera um único efeito. Se o worker morre depois do commit e antes do ack, na redelivery ele só dá ack.
