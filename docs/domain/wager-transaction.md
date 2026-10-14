# WagerTransaction — `WagerTransactionAggregate`

OLD_README §6.3, §7 e §9. Convenções gerais em @docs/domain/shared.md.

## Papel

**O pedido do provedor e o que aconteceu com ele.** Cada `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK` recebido vira uma `WagerTransaction`, inclusive quando é rejeitado, quando não mexe no saldo (`LOSS`) ou quando fica esperando a referência. É ela que guarda:

- a **idempotência** (`idempotencyKey` + `payloadHash`);
- a **referência** para outra transação (`REFUND`/`ROLLBACK`);
- o **estado** e o `failureCode`;
- o **saldo observado** no momento da decisão, para o replay devolver o resultado original (OLD_README §7, regra 7).

O lançamento no extrato é outra classe (@docs/domain/wallet-ledger-entry.md) e só existe quando o dinheiro de fato se move.

## Máquina de estados

```
            ┌──────────► PROCESSED  (terminal)
            │
PENDING ────┼──────────► REJECTED   (terminal)
   │        │
   │        └──────────► FAILED     (terminal)
   │
   └─► PENDING_REFERENCE ──► PROCESSED | REJECTED | FAILED
          │      ▲
          └──────┘ scheduleReferenceRetry (nova tentativa)
```

| Método | De | Para |
|---|---|---|
| `markPendingReference(nextAttemptAt)` | `PENDING` | `PENDING_REFERENCE` |
| `scheduleReferenceRetry(nextAttemptAt)` | `PENDING_REFERENCE` | `PENDING_REFERENCE` (attempts + 1) |
| `markProcessed(referenceTransactionId, at, observedBalance)` | `PENDING`, `PENDING_REFERENCE` | `PROCESSED` |
| `reject(code, at, observedBalance?)` | `PENDING`, `PENDING_REFERENCE` | `REJECTED` |
| `fail(code, at)` | `PENDING`, `PENDING_REFERENCE` | `FAILED` |

Qualquer transição fora desta tabela **lança** `InvalidTransactionStateError` (erro de programação, OLD_README §6.3).

Na prática, a transação nasce `PENDING` em memória e é decidida antes do commit. O `PENDING` raramente chega ao banco.

## Regras

- `OPENING` é interno: `create` recusa e só `createOpening` gera esse kind.
- `REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId`. `WIN` pode ter (aponta para a `BET`).
- Valor: positivo para kinds que mexem no saldo. `LOSS` aceita `0.00` ou mais.
- A referência é buscada por `(providerId, referenceExternalTransactionId)` e precisa ser do **mesmo provider, player, wallet, moeda e rodada** (`validateReference`).
- `REFUND` só referencia `BET`. `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`. `WIN` só referencia `BET`.
- `REFUND`/`ROLLBACK` têm o **mesmo valor** da referência.
- A referência precisa estar `PROCESSED`.
- Não reverter a mesma referência duas vezes pelo mesmo kind: checado pelo repository **e** pelo índice único parcial no banco (a entidade não enxerga as outras transações).
- Mesma `idempotencyKey` com `payloadHash` diferente: `IDEMPOTENCY_CONFLICT` (409), sem gravar nada.
- O cálculo do `payloadHash` (JSON canônico + SHA-256) fica na camada **application**. O domínio só compara (`matchesPayload`).

### Direção do lançamento (`ledgerDirectionFor`)

| Kind | Direção |
|---|---|
| `OPENING`, `WIN`, `REFUND` | `CREDIT` |
| `BET` | `DEBIT` |
| `LOSS` | não tem (lança erro: `affectsBalance()` é `false`) |
| `ROLLBACK` de `BET` | `CREDIT` |
| `ROLLBACK` de `WIN` ou `REFUND` | `DEBIT` |

## wager-transaction.enums.ts
```ts
enum WagerTransactionKind {
  Opening = "OPENING", // internal: wallet opening credit
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

enum WagerTransactionStatus {
  Pending = "PENDING",                     // accepted, not applied yet
  PendingReference = "PENDING_REFERENCE",  // waiting for the referenced transaction
  Processed = "PROCESSED",                 // applied (terminal)
  Rejected = "REJECTED",                   // business rule violation (terminal)
  Failed = "FAILED",                       // permanent infrastructure error (terminal, auditable)
}

export { WagerTransactionKind, WagerTransactionStatus };
```

## wager-transaction.props.ts
```ts
import { DateValueObject, IBaseDomainAggregate, IdValueObject } from "ddd-tool-kit";

import { FailureCode } from "../shared/failure-code";
import { MoneyValueObject } from "../money/money.value-object";
import { WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums";

interface IWagerTransactionProps extends IBaseDomainAggregate {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: IdValueObject;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyValueObject;
  /** Provider id of the referenced transaction, not our internal id. */
  referenceExternalTransactionId?: string;
  status: WagerTransactionStatus;
  /** Our internal id of the referenced transaction, filled when it is resolved. */
  referenceTransactionId?: IdValueObject;
  failureCode?: FailureCode;
  /** Wallet balance right after this transaction was decided. Returned on replay (OLD_README §7 rule 7). */
  observedBalance?: MoneyValueObject;
  processedAt?: DateValueObject;
  referenceAttempts: number;
  nextReferenceAttemptAt?: DateValueObject;
}

/** What a provider sends (HTTP body or SQS `data`), already validated into domain types. */
interface ICreateWagerTransactionProps {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: IdValueObject;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyValueObject;
  referenceExternalTransactionId?: string;
}

interface ICreateOpeningProps {
  walletId: IdValueObject;
  playerId: string;
  money: MoneyValueObject;
  payloadHash: string;
}

export { IWagerTransactionProps, ICreateWagerTransactionProps, ICreateOpeningProps };
```

## wager-transaction.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

const INVALID_WAGER_TRANSACTION: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid wager transaction: missing or empty fields.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const OPENING_NOT_ALLOWED: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "OPENING is internal and cannot be submitted.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const REFERENCE_REQUIRED: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "REFUND and ROLLBACK require referenceExternalTransactionId.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const INVALID_WAGER_AMOUNT: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Amount must be positive (LOSS accepts 0.00).",
  statusCode: HttpStatus.BAD_REQUEST,
};

const IDEMPOTENCY_CONFLICT: IDomainError = {
  code: FailureCode.IdempotencyConflict,
  message: "Idempotency-Key already used with a different payload.",
  statusCode: HttpStatus.CONFLICT,
};

const TRANSACTION_NOT_FOUND: IDomainError = {
  code: FailureCode.TransactionNotFound,
  message: "Wager transaction does not exist.",
  statusCode: HttpStatus.NOT_FOUND,
};

const WALLET_PLAYER_MISMATCH: IDomainError = {
  code: FailureCode.WalletPlayerMismatch,
  message: "The wallet does not belong to this player.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_NOT_FOUND: IDomainError = {
  code: FailureCode.ReferenceNotFound,
  message: "Referenced transaction was not received within the retry limit.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_KIND_NOT_ALLOWED: IDomainError = {
  code: FailureCode.ReferenceKindNotAllowed,
  message: "REFUND references only BET; ROLLBACK references BET, WIN or REFUND; WIN references only BET.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_MISMATCH: IDomainError = {
  code: FailureCode.ReferenceMismatch,
  message: "Reference must have the same provider, player, wallet, currency and round.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_AMOUNT_MISMATCH: IDomainError = {
  code: FailureCode.ReferenceAmountMismatch,
  message: "Reversal amount must equal the referenced amount.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_NOT_PROCESSED: IDomainError = {
  code: FailureCode.ReferenceNotProcessed,
  message: "Referenced transaction is not PROCESSED.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_ALREADY_REVERSED: IDomainError = {
  code: FailureCode.ReferenceAlreadyReversed,
  message: "Referenced transaction was already reverted by this kind of operation.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** Programming error: transition not allowed from the current status. */
class InvalidTransactionStateError extends Error {
  constructor(transactionId: string, from: string, to: string) {
    super(`WagerTransaction ${transactionId} cannot go from ${from} to ${to}.`);
    this.name = "InvalidTransactionStateError";
  }
}

export {
  INVALID_WAGER_TRANSACTION,
  OPENING_NOT_ALLOWED,
  REFERENCE_REQUIRED,
  INVALID_WAGER_AMOUNT,
  IDEMPOTENCY_CONFLICT,
  TRANSACTION_NOT_FOUND,
  WALLET_PLAYER_MISMATCH,
  REFERENCE_NOT_FOUND,
  REFERENCE_KIND_NOT_ALLOWED,
  REFERENCE_MISMATCH,
  REFERENCE_AMOUNT_MISMATCH,
  REFERENCE_NOT_PROCESSED,
  REFERENCE_ALREADY_REVERSED,
  InvalidTransactionStateError,
};
```

## wager-transaction.aggregate-root.ts
```ts
import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { FailureCode } from "../shared/failure-code";
import { MoneyValueObject } from "../money/money.value-object";
import { LedgerDirection } from "../wallet-ledger-entry/wallet-ledger-entry.props";
import { WagerTransactionKind as Kind, WagerTransactionStatus as Status } from "./wager-transaction.enums";
import {
  ICreateOpeningProps,
  ICreateWagerTransactionProps,
  IWagerTransactionProps,
} from "./wager-transaction.props";
import {
  INVALID_WAGER_AMOUNT,
  INVALID_WAGER_TRANSACTION,
  InvalidTransactionStateError,
  OPENING_NOT_ALLOWED,
  REFERENCE_AMOUNT_MISMATCH,
  REFERENCE_KIND_NOT_ALLOWED,
  REFERENCE_MISMATCH,
  REFERENCE_NOT_PROCESSED,
  REFERENCE_REQUIRED,
} from "./wager-transaction.errors";

const INTERNAL_PROVIDER_ID = "internal";

const TERMINAL_STATUSES = [Status.Processed, Status.Rejected, Status.Failed];
const UNDECIDED_STATUSES = [Status.Pending, Status.PendingReference];

const ALLOWED_REFERENCE_KINDS: Partial<Record<Kind, Kind[]>> = {
  [Kind.Win]: [Kind.Bet],
  [Kind.Refund]: [Kind.Bet],
  [Kind.Rollback]: [Kind.Bet, Kind.Win, Kind.Refund],
};

class WagerTransactionAggregate extends Aggregate<IWagerTransactionProps> {
  private constructor(props: IWagerTransactionProps) {
    super(props);
  }

  // ---- getters
  get providerId() { return this.props.providerId; }
  get externalTransactionId() { return this.props.externalTransactionId; }
  get idempotencyKey() { return this.props.idempotencyKey; }
  get payloadHash() { return this.props.payloadHash; }
  get walletId() { return this.props.walletId; }
  get playerId() { return this.props.playerId; }
  get roundId() { return this.props.roundId; }
  get gameId() { return this.props.gameId; }
  get kind() { return this.props.kind; }
  get money() { return this.props.money; }
  get referenceExternalTransactionId() { return this.props.referenceExternalTransactionId; }
  get status() { return this.props.status; }
  get referenceTransactionId() { return this.props.referenceTransactionId; }
  get failureCode() { return this.props.failureCode; }
  get observedBalance() { return this.props.observedBalance; }
  get processedAt() { return this.props.processedAt; }
  get referenceAttempts() { return this.props.referenceAttempts; }
  get nextReferenceAttemptAt() { return this.props.nextReferenceAttemptAt; }

  // ---- transitions
  markPendingReference(nextAttemptAt: DateValueObject): void {
    this.assertTransition([Status.Pending], Status.PendingReference);
    this.props.status = Status.PendingReference;
    this.props.nextReferenceAttemptAt = nextAttemptAt;
    this.touch();
  }

  scheduleReferenceRetry(nextAttemptAt: DateValueObject): void {
    this.assertTransition([Status.PendingReference], Status.PendingReference);
    this.props.referenceAttempts += 1;
    this.props.nextReferenceAttemptAt = nextAttemptAt;
    this.touch();
  }

  markProcessed(
    referenceTransactionId: IdValueObject | undefined,
    at: DateValueObject,
    observedBalance: MoneyValueObject,
  ): void {
    this.assertTransition(UNDECIDED_STATUSES, Status.Processed);
    this.props.status = Status.Processed;
    this.props.referenceTransactionId = referenceTransactionId;
    this.props.observedBalance = observedBalance;
    this.props.processedAt = at;
    this.props.nextReferenceAttemptAt = undefined;
    this.touch();
  }

  reject(code: FailureCode, at: DateValueObject, observedBalance?: MoneyValueObject): void {
    this.assertTransition(UNDECIDED_STATUSES, Status.Rejected);
    this.props.status = Status.Rejected;
    this.props.failureCode = code;
    this.props.observedBalance = observedBalance;
    this.props.processedAt = at;
    this.props.nextReferenceAttemptAt = undefined;
    this.touch();
  }

  fail(code: FailureCode, at: DateValueObject): void {
    this.assertTransition(UNDECIDED_STATUSES, Status.Failed);
    this.props.status = Status.Failed;
    this.props.failureCode = code;
    this.props.processedAt = at;
    this.props.nextReferenceAttemptAt = undefined;
    this.touch();
  }

  // ---- domain queries
  isTerminal(): boolean {
    return TERMINAL_STATUSES.includes(this.props.status);
  }

  affectsBalance(): boolean {
    return this.props.kind !== Kind.Loss;
  }

  requiresReference(): boolean {
    return this.props.kind === Kind.Refund || this.props.kind === Kind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.props.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransactionAggregate): LedgerDirection {
    switch (this.props.kind) {
      case Kind.Opening:
      case Kind.Win:
      case Kind.Refund:
        return LedgerDirection.Credit;
      case Kind.Bet:
        return LedgerDirection.Debit;
      case Kind.Rollback: {
        if (!reference) throw new Error("ROLLBACK needs its reference to know the direction.");
        const referenceDirection = reference.ledgerDirectionFor();
        return referenceDirection === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
      }
      case Kind.Loss:
        throw new Error("LOSS does not affect the balance and has no ledger direction.");
    }
  }

  /** OLD_README §7 rules 2, 3 and 5. "Not reverted twice" is checked by the repository + DB index. */
  validateReference(reference: WagerTransactionAggregate) {
    const allowedKinds = ALLOWED_REFERENCE_KINDS[this.props.kind] ?? [];
    if (!allowedKinds.includes(reference.kind)) return Output.fail(REFERENCE_KIND_NOT_ALLOWED);

    if (reference.status !== Status.Processed) return Output.fail(REFERENCE_NOT_PROCESSED);

    const sameContext =
      reference.providerId === this.props.providerId &&
      reference.playerId === this.props.playerId &&
      reference.walletId.equals(this.props.walletId) &&
      reference.roundId === this.props.roundId &&
      reference.money.currency === this.props.money.currency;
    if (!sameContext) return Output.fail(REFERENCE_MISMATCH);

    if (this.requiresReference() && !reference.money.equals(this.props.money)) {
      return Output.fail(REFERENCE_AMOUNT_MISMATCH);
    }

    return Output.success();
  }

  // ---- internals
  private assertTransition(allowedFrom: Status[], to: Status): void {
    if (!allowedFrom.includes(this.props.status)) {
      throw new InvalidTransactionStateError(this.id.value, this.props.status, to);
    }
  }

  private touch(): void {
    this.props.updatedAt = DateValueObject.getDefault();
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = ["walletId", "money", ...this.defaultValueObjects];
    const requiredProps = [
      ...valueObjects,
      "providerId",
      "externalTransactionId",
      "idempotencyKey",
      "payloadHash",
      "playerId",
      "roundId",
      "gameId",
      "kind",
      "status",
    ];

    return verifyAllPropsExists(requiredProps, this) && verifyAreValueObjects(valueObjects, this);
  }

  // ---- factories
  /** Submitted by a provider (HTTP or SQS). Born PENDING. */
  static create(props: ICreateWagerTransactionProps) {
    if (props.kind === Kind.Opening) return Output.fail(OPENING_NOT_ALLOWED);
    if (!Object.values(Kind).includes(props.kind)) return Output.fail(INVALID_WAGER_TRANSACTION);

    const transaction = new WagerTransactionAggregate({
      ...props,
      status: Status.Pending,
      referenceAttempts: 0,
    });

    if (!transaction.isValidProps()) return Output.fail(INVALID_WAGER_TRANSACTION);

    if (transaction.requiresReference() && !props.referenceExternalTransactionId) {
      return Output.fail(REFERENCE_REQUIRED);
    }

    const validAmount = transaction.affectsBalance()
      ? props.money.isPositive()
      : !props.money.isNegative();
    if (!validAmount) return Output.fail(INVALID_WAGER_AMOUNT);

    return Output.success(transaction);
  }

  /** Internal OPENING credit, created together with the wallet. Born PROCESSED. */
  static createOpening(props: ICreateOpeningProps): WagerTransactionAggregate {
    const id = IdValueObject.getDefault();
    const now = DateValueObject.getDefault();

    return new WagerTransactionAggregate({
      id,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: `opening:${props.walletId.value}`,
      idempotencyKey: `${INTERNAL_PROVIDER_ID}:opening:${props.walletId.value}`,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: "opening",
      gameId: "opening",
      kind: Kind.Opening,
      money: props.money,
      status: Status.Processed,
      observedBalance: props.money,
      processedAt: now,
      referenceAttempts: 0,
    });
  }

  /** Rebuilds persisted state. Does not revalidate transitions. */
  static rehydrate(props: IWagerTransactionProps): WagerTransactionAggregate {
    return new WagerTransactionAggregate(props);
  }
}

export { WagerTransactionAggregate };
```

## Uso: como o use case combina as peças

`SubmitWagerTransactionService` (mesmo service para HTTP e SQS). Tudo dentro de **uma** `uow.transactional`:

```
1. payloadHash = canonicalHash(input)                       (application)
2. existente = txRepository.findByIdempotencyKey(key)
     existe e matchesPayload  → replay: status + observedBalance, idempotentReplay: true
     existe e não bate        → IDEMPOTENCY_CONFLICT (409)
3. money = MoneyValueObject.from(input.money)               → INVALID_PAYLOAD se falhar
4. tx = WagerTransactionAggregate.create(...)               → INVALID_PAYLOAD/INVALID_AMOUNT se falhar
5. wallet = walletRepository.findByIdForUpdate(walletId)    → WALLET_NOT_FOUND (404) se não existir
     wallet.playerId ≠ tx.playerId → tx.reject(WALLET_PLAYER_MISMATCH)
6. se tx precisa de referência (ou WIN com referência):
     ref = txRepository.findByExternalId(providerId, referenceExternalTransactionId)
       não achou → tx.markPendingReference(próxima tentativa) → outbox PendingReference → 202
       achou     → tx.validateReference(ref) → falhou: tx.reject(code)
                   txRepository.isAlreadyReversed(ref.id, tx.kind) → tx.reject(REFERENCE_ALREADY_REVERSED)
7. se tx.affectsBalance():
     direction = tx.ledgerDirectionFor(ref)
     DEBIT  → wallet.debit(money, tx.id, kind === ROLLBACK ? REVERSAL_WOULD_OVERDRAW : INSUFFICIENT_FUNDS)
     CREDIT → wallet.credit(money, tx.id)
     falhou → tx.reject(code, at, wallet.balance)
     ok     → tx.markProcessed(ref?.id, at, wallet.balance)
   senão (LOSS): tx.markProcessed(ref?.id, at, wallet.balance)
8. salvar: tx, wallet (se mudou: walletRepository.save grava a carteira + o lançamento novo), outbox (eventos), inbox (se veio do SQS)
9. COMMIT. Se o INSERT da tx bater no UNIQUE (idempotency_key): rollback, reler e responder como replay.
```

## Persistência

```sql
create table "wager_transactions" (
  "id"                                char(16)      primary key,
  "provider_id"                       text          not null,
  "external_transaction_id"           text          not null,
  "idempotency_key"                   text          not null,
  "payload_hash"                      char(64)      not null,
  "wallet_id"                         char(16)      not null references "wallets" ("id"),
  "player_id"                         text          not null,
  "round_id"                          text          not null,
  "game_id"                           text          not null,
  "kind"                              text          not null check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
  "amount"                            numeric(19,2) not null check ("amount" >= 0),
  "currency"                          char(3)       not null,
  "reference_external_transaction_id" text,
  "status"                            text          not null check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
  "reference_transaction_id"          char(16)      references "wager_transactions" ("id"),
  "failure_code"                      text,
  "observed_balance_amount"           numeric(19,2),
  "processed_at"                      timestamptz,
  "reference_attempts"                integer       not null default 0,
  "next_reference_attempt_at"         timestamptz,
  "created_at"                        timestamptz   not null,
  "updated_at"                        timestamptz   not null,
  constraint "wager_tx_idempotency_key_unique" unique ("idempotency_key"),
  constraint "wager_tx_provider_external_unique" unique ("provider_id", "external_transaction_id"),
  check ("kind" not in ('REFUND','ROLLBACK') or "reference_external_transaction_id" is not null),
  check ("status" <> 'REJECTED' or "failure_code" is not null)
);

-- A reference cannot be reverted twice by the same kind (OLD_README §7 rule 4)
create unique index "wager_tx_single_reversal"
  on "wager_transactions" ("reference_transaction_id", "kind")
  where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');

-- Pending-reference worker
create index "wager_tx_pending_reference_due"
  on "wager_transactions" ("next_reference_attempt_at")
  where "status" = 'PENDING_REFERENCE';
```

## Testes unitários obrigatórios

- `create` recusa `OPENING`, `REFUND`/`ROLLBACK` sem referência e valor zero (exceto `LOSS`).
- Transições válidas da tabela e **todas** as inválidas lançando `InvalidTransactionStateError` (ex.: `markProcessed` em `REJECTED`).
- `affectsBalance` é `false` só para `LOSS`. `requiresReference` é `true` só para `REFUND` e `ROLLBACK`.
- `ledgerDirectionFor` para cada kind, incluindo `ROLLBACK` de `BET`, `WIN` e `REFUND`.
- `validateReference`: kind não permitido, referência não `PROCESSED`, contexto diferente (provider, player, wallet, moeda, rodada) e valor diferente.
- `matchesPayload` com o mesmo hash e com hash diferente (idempotency key com payload divergente).
