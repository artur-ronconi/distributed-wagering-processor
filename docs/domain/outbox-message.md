# OutboxMessage — `OutboxMessageAggregate`

OLD_README §6.5 e §11. Convenções gerais em @docs/domain/shared.md.

## Papel

**Um evento esperando para ser publicado.** O banco e o SQS não participam da mesma transação. Publicar antes do commit pode anunciar algo que não aconteceu, e publicar depois pode perder o evento se o processo cair. Então o evento é gravado como uma linha na tabela `outbox`, **na mesma transação** da alteração financeira. Depois, um worker publica as linhas pendentes no SQS.

A garantia é **at-least-once**: nunca perde um evento confirmado, mas pode publicar duas vezes (por exemplo, se o worker cair entre publicar e marcar como publicado). Quem consome deduplica pelo `eventId`.

O **conteúdo** do evento é responsabilidade do `IntegrationEvent` (@docs/domain/integration-event.md). A outbox só cuida da **entrega**.

## Lugar no modelo: aggregate de um só

Cada mensagem tem ciclo de vida próprio (`enqueue` → `scheduleRetry`… → `markPublished`), é carregada e salva sozinha pelo publisher e não pertence a nenhum outro aggregate. Por isso é um **aggregate** (`Aggregate` do toolkit), formado só pelo root.

Não é um conceito de negócio. É um mecanismo técnico de mensageria, então fica no módulo `src/modules/messaging/`, separado de Wallet e WagerTransaction.

## Regras

- `id` = `eventId` do evento.
- Nasce pendente: `attempts = 0`, `nextAttemptAt = occurredAt`, `publishedAt` vazio.
- `scheduleRetry(now)` incrementa `attempts` e agenda a próxima tentativa com backoff exponencial: 1s, 2s, 4s… até no máximo 5 min.
- `markPublished(at)` só pode ser chamado uma vez.
- Várias instâncias do publisher leem a tabela com `FOR UPDATE SKIP LOCKED`, então cada linha é trabalhada por uma instância de cada vez.
- `payload` é JSON estável (`event.toJSON()`), nunca instâncias de classes de domínio.
- `occurredAt` é quando o fato aconteceu (vem do evento). `createdAt`/`updatedAt` são do registro: quando entrou na outbox e a última tentativa.

## Camadas: por que existe o `IOutboxEvent`

O OLD_README define `OutboxMessage.enqueue(event: IntegrationEvent)`. Mas o `IntegrationEvent` mora na camada **application**, e o domínio não pode importar de lá. A solução é o domínio definir a interface mínima de que precisa. Como o `IntegrationEvent` tem esses campos, o TypeScript aceita qualquer evento sem import.

## outbox-event.interface.ts
```ts
/** What the outbox needs from an event. IntegrationEvent (application layer) satisfies it. */
interface IOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  toJSON(): Record<string, unknown>;
}

export { IOutboxEvent };
```

## outbox-message.props.ts
```ts
import { DateValueObject, IBaseDomainAggregate } from "ddd-tool-kit";

interface IOutboxMessageProps extends IBaseDomainAggregate {
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: DateValueObject;
  attempts: number;
  nextAttemptAt: DateValueObject;
  publishedAt?: DateValueObject;
}

export { IOutboxMessageProps };
```

## outbox-message.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../../shared/domain-error";
import { FailureCode } from "../../shared/failure-code";

// Should never reach a provider: events are built by our own code.
const INVALID_OUTBOX_MESSAGE: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Outbox message requires a valid eventId, eventType, aggregateId and payload.",
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Programming error: the message was already published. */
class OutboxMessageAlreadyPublishedError extends Error {
  constructor(id: string) {
    super(`Outbox message ${id} is already published.`);
    this.name = "OutboxMessageAlreadyPublishedError";
  }
}

export { INVALID_OUTBOX_MESSAGE, OutboxMessageAlreadyPublishedError };
```

## outbox-message.aggregate-root.ts
```ts
import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IOutboxEvent } from "./outbox-event.interface";
import { IOutboxMessageProps } from "./outbox-message.props";
import { INVALID_OUTBOX_MESSAGE, OutboxMessageAlreadyPublishedError } from "./outbox-message.errors";

class OutboxMessageAggregate extends Aggregate<IOutboxMessageProps> {
  private static readonly BASE_DELAY_MS = 1_000;
  private static readonly MAX_DELAY_MS = 5 * 60_000;

  private constructor(props: IOutboxMessageProps) {
    super(props);
  }

  get aggregateId() {
    return this.props.aggregateId;
  }

  get eventType() {
    return this.props.eventType;
  }

  get payload() {
    return this.props.payload;
  }

  get occurredAt() {
    return this.props.occurredAt;
  }

  get attempts() {
    return this.props.attempts;
  }

  get nextAttemptAt() {
    return this.props.nextAttemptAt;
  }

  get publishedAt() {
    return this.props.publishedAt;
  }

  isPending(): boolean {
    return this.props.publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this.props.nextAttemptAt.value.getTime() <= now.getTime();
  }

  markPublished(at: DateValueObject): void {
    if (!this.isPending()) throw new OutboxMessageAlreadyPublishedError(this.id.value);
    this.props.publishedAt = at;
    this.props.updatedAt = at;
  }

  /** Increments attempts and schedules the next try with exponential backoff (1s, 2s, 4s… max 5 min). */
  scheduleRetry(now: Date): void {
    this.props.attempts += 1;

    const exponent = Math.min(this.props.attempts - 1, 20);
    const delay = Math.min(
      OutboxMessageAggregate.BASE_DELAY_MS * 2 ** exponent,
      OutboxMessageAggregate.MAX_DELAY_MS,
    );

    this.props.nextAttemptAt = DateValueObject.init({
      value: new Date(now.getTime() + delay),
    }).result as DateValueObject;
    this.props.updatedAt = DateValueObject.init({ value: now }).result as DateValueObject;
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = ["occurredAt", "nextAttemptAt", ...this.defaultValueObjects];
    // `attempts` is not listed: verifyAllPropsExists rejects 0.
    const requiredProps = [...valueObjects, "aggregateId", "eventType", "payload"];

    return (
      verifyAllPropsExists(requiredProps, this) &&
      verifyAreValueObjects(valueObjects, this) &&
      Number.isInteger(this.props.attempts) &&
      this.props.attempts >= 0
    );
  }

  static enqueue(event: IOutboxEvent) {
    const createId = IdValueObject.init({ value: event.eventId });
    if (createId.isFailure) return Output.fail(INVALID_OUTBOX_MESSAGE);

    const occurredAt = DateValueObject.init({ value: event.occurredAt });
    if (occurredAt.isFailure) return Output.fail(INVALID_OUTBOX_MESSAGE);

    const message = new OutboxMessageAggregate({
      id: createId.result as IdValueObject,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: occurredAt.result as DateValueObject,
      attempts: 0,
      nextAttemptAt: occurredAt.result as DateValueObject,
    });

    const isInvalidProps = !message.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_OUTBOX_MESSAGE);

    return Output.success(message);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IOutboxMessageProps): OutboxMessageAggregate {
    return new OutboxMessageAggregate(props);
  }
}

export { OutboxMessageAggregate };
```

## outbox-message.repository.ts (porta, application)
```ts
import { OutboxMessageAggregate } from "../../domain/messaging/outbox-message/outbox-message.aggregate-root";

interface OutboxMessageRepository {
  insert(message: OutboxMessageAggregate): Promise<void>;
  /** Must run inside uow.transactional. SELECT ... FOR UPDATE SKIP LOCKED of due, unpublished rows. */
  lockDueBatch(now: Date, limit: number): Promise<OutboxMessageAggregate[]>;
  /** Saves attempts, next_attempt_at, published_at, updated_at. */
  save(message: OutboxMessageAggregate): Promise<void>;
}

export { OutboxMessageRepository };
```

## Uso

### No use case (mesma transação do dinheiro)
```ts
const events = [
  WagerTransactionProcessed.from(tx, ctx),
  WalletBalanceChanged.from(wallet, entry, ctx),
];

for (const event of events) {
  const enqueue = OutboxMessageAggregate.enqueue(event);
  if (enqueue.isFailure) return throwFailOutput(enqueue);
  await outboxRepository.insert(enqueue.result as OutboxMessageAggregate);
}
```

### No publisher (worker, N instâncias)
```ts
await uow.transactional(async () => {
  const batch = await outboxRepository.lockDueBatch(new Date(), 50); // FOR UPDATE SKIP LOCKED

  for (const message of batch) {
    try {
      await eventPublisher.publish(message.eventType, message.payload);
      message.markPublished(DateValueObject.getDefault());
    } catch (error) {
      message.scheduleRetry(new Date());
    }
    await outboxRepository.save(message);
  }
});
```

O tempo de lock depende do tamanho do lote e da latência do SQS. Lotes pequenos deixam o lock curto. Uma alternativa é um lease (`locked_until`), mas ela adiciona complexidade. Documentar a escolha.

## Persistência

```sql
create table "outbox_messages" (
  "id"              char(16)    primary key,  -- = eventId
  "aggregate_id"    char(16)    not null,
  "event_type"      text        not null,
  "payload"         jsonb       not null,
  "occurred_at"     timestamptz not null,
  "attempts"        integer     not null default 0 check ("attempts" >= 0),
  "next_attempt_at" timestamptz not null,
  "published_at"    timestamptz,
  "created_at"      timestamptz not null,
  "updated_at"      timestamptz not null
);

create index "outbox_pending_due"
  on "outbox_messages" ("next_attempt_at")
  where "published_at" is null;
```

Métrica de **outbox lag** (OLD_README §12): `now() - min(occurred_at) where published_at is null`.

## Testes

- Unitário: `enqueue` cria pendente com `attempts = 0`. `isDue` antes e depois de `nextAttemptAt`. `scheduleRetry` gera 1s, 2s, 4s… e para em 5 min. `markPublished` duas vezes lança erro.
- Integração (OLD_README §13): dois publishers sobre a mesma outbox não publicam a mesma linha ao mesmo tempo. Se o commit foi confirmado e o processo morre antes de publicar, outra instância publica depois.
