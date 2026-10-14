# IntegrationEvent — eventos de integração

OLD_README §11. Convenções gerais em @docs/domain/shared.md.

> **Camada:** `src/application/events/`. Não é domínio. Fica documentado aqui porque o `OutboxMessageAggregate` depende dele (pela interface `IOutboxEvent`, sem import).

## Papel

**O formato oficial dos avisos que saem do serviço.** Outros sistemas (notificação, BI, antifraude) leem esses eventos de uma fila, então o JSON é um **contrato** com quem não controlamos. O `IntegrationEvent` garante que todo aviso:

- tenha sempre o mesmo envelope (`eventId`, `eventType`, `version`, `aggregateId`, `correlationId`, `causationId`, `occurredAt`);
- tenha o `data` com formato fixo por tipo, definido num lugar só (a fábrica `from`);
- carregue dinheiro como `MoneyProps` (`{ "amount": "25.00", "currency": "BRL" }`), nunca como instância de `MoneyValueObject`.

Ele vive em memória por alguns milissegundos: o use case cria, o `OutboxMessageAggregate.enqueue(event)` guarda o `event.toJSON()` e pronto.

## Regras

- Classe **abstrata**, com uma subclasse concreta por evento.
- `eventType` e `version` ficam **no tipo** da subclasse, nunca numa string solta no call site.
- `eventId` é gerado com `IdValueObject.getDefault()` (16 caracteres), porque vira o `id` da linha da outbox.
- Ao mudar o formato de um evento, crie a `version = 2` em vez de alterar a 1.
- Eventos mínimos:

| Evento | Quando |
|---|---|
| `WagerTransactionProcessed` | qualquer transação aplicada, inclusive `LOSS` |
| `WagerTransactionRejected` | transação rejeitada por regra de negócio |
| `WalletBalanceChanged` | **somente** quando o saldo muda |
| `WagerTransactionPendingReference` | referência ausente |

## integration-event.ts
```ts
import { IdValueObject } from "ddd-tool-kit";
import { IOutboxEvent } from "../../domain/messaging/outbox-message/outbox-event.interface";

interface EventContext {
  correlationId: string; // ties every log and event of one request together
  causationId?: string;  // what directly caused it, e.g. the SQS messageId
  now: Date;
}

interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

abstract class IntegrationEvent<T> implements IOutboxEvent {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze({ ...props.data });
  }

  protected static envelope<T>(aggregateId: string, ctx: EventContext, data: T): IntegrationEventProps<T> {
    return {
      eventId: IdValueObject.getDefault().value,
      aggregateId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data,
    };
  }

  /** Serialized envelope stored in the outbox payload. */
  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data as T,
    };
  }
}

export { IntegrationEvent, IntegrationEventProps, EventContext };
```

## wallet-balance-changed.event.ts
```ts
import { MoneyProps } from "../../domain/money/money.props";
import { LedgerDirection } from "../../domain/wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletAggregate } from "../../domain/wallet/wallet.aggregate-root";
import { WalletLedgerEntryEntity } from "../../domain/wallet-ledger-entry/wallet-ledger-entry.entity";
import { EventContext, IntegrationEvent } from "./integration-event";

interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  static from(wallet: WalletAggregate, entry: WalletLedgerEntryEntity, ctx: EventContext) {
    return new WalletBalanceChanged(
      IntegrationEvent.envelope(wallet.id.value, ctx, {
        walletId: wallet.id.value,
        transactionId: entry.transactionId.value,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      }),
    );
  }
}

export { WalletBalanceChanged, WalletBalanceChangedData };
```

## wager-transaction.event-data.ts (base dos três eventos de transação)
```ts
import { MoneyProps } from "../../domain/money/money.props";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager-transaction/wager-transaction.enums";

interface WagerTransactionEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

const toWagerTransactionEventData = (tx: WagerTransactionAggregate): WagerTransactionEventData => ({
  transactionId: tx.id.value,
  providerId: tx.providerId,
  externalTransactionId: tx.externalTransactionId,
  walletId: tx.walletId.value,
  playerId: tx.playerId,
  roundId: tx.roundId,
  gameId: tx.gameId,
  kind: tx.kind,
  status: tx.status,
  money: tx.money.toJSON(),
  referenceExternalTransactionId: tx.referenceExternalTransactionId,
});

export { WagerTransactionEventData, toWagerTransactionEventData };
```

## wager-transaction-processed.event.ts
```ts
import { MoneyProps } from "../../domain/money/money.props";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { EventContext, IntegrationEvent } from "./integration-event";
import { toWagerTransactionEventData, WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionProcessedData extends WagerTransactionEventData {
  referenceTransactionId?: string;
  balance: MoneyProps; // observed balance after processing
}

class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionProcessed(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        referenceTransactionId: tx.referenceTransactionId?.value,
        balance: tx.observedBalance!.toJSON(), // always set by markProcessed
      }),
    );
  }
}

export { WagerTransactionProcessed, WagerTransactionProcessedData };
```

## wager-transaction-rejected.event.ts
```ts
import { FailureCode } from "../../domain/shared/failure-code";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { EventContext, IntegrationEvent } from "./integration-event";
import { toWagerTransactionEventData, WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionRejectedData extends WagerTransactionEventData {
  failureCode: FailureCode;
}

class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionRejected(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        failureCode: tx.failureCode!, // always set by reject
      }),
    );
  }
}

export { WagerTransactionRejected, WagerTransactionRejectedData };
```

## wager-transaction-pending-reference.event.ts
```ts
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { EventContext, IntegrationEvent } from "./integration-event";
import { toWagerTransactionEventData, WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionPendingReferenceData extends WagerTransactionEventData {
  nextAttemptAt: string; // ISO-8601
}

class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionPendingReference(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        nextAttemptAt: tx.nextReferenceAttemptAt!.value.toISOString(), // always set by markPendingReference
      }),
    );
  }
}

export { WagerTransactionPendingReference, WagerTransactionPendingReferenceData };
```

## Quais eventos cada resultado gera

| Resultado | Eventos |
|---|---|
| `PROCESSED` com mudança de saldo (`BET`, `WIN`, `REFUND`, `ROLLBACK`, `OPENING`) | `WagerTransactionProcessed` + `WalletBalanceChanged` |
| `PROCESSED` sem mudança de saldo (`LOSS`) | `WagerTransactionProcessed` |
| `REJECTED` | `WagerTransactionRejected` |
| `PENDING_REFERENCE` | `WagerTransactionPendingReference` |
| Replay idempotente | nenhum (já foram gerados na primeira vez) |

## Testes unitários

- Cada `from` gera o `eventType` e a `version` corretos e o `data` no formato esperado.
- `toJSON()` serializa dinheiro como string (`"25.00"`) e datas em ISO-8601.
- Dois eventos criados em sequência têm `eventId` diferentes.
