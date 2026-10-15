import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { FailureCode } from "../../../../../shared/domain/failure-code";
import { MoneyValueObject } from "../../../../wallet/domain/aggregate/value-objects/money/money.value-object";
import { LedgerDirection } from "../../../../wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import {
  PROVIDER_KINDS,
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from "./wager-transaction.enums";
import {
  type ICreateOpeningProps,
  type ICreateWagerTransactionProps,
  type ICreateWalletOperationProps,
  type IWagerTransactionProps,
} from "./wager-transaction.props";
import {
  INTERNAL_KIND_NOT_ALLOWED,
  INVALID_WAGER_AMOUNT,
  INVALID_WAGER_TRANSACTION,
  INVALID_WALLET_OPERATION,
  InvalidTransactionStateError,
  REFERENCE_AMOUNT_MISMATCH,
  REFERENCE_KIND_NOT_ALLOWED,
  REFERENCE_MISMATCH,
  REFERENCE_NOT_PROCESSED,
  REFERENCE_REQUIRED,
} from "./wager-transaction.errors";

const INTERNAL_PROVIDER_ID = "internal";
const WALLET_OPERATION_ROUND_ID = "wallet-operation";
const WALLET_OPERATION_GAME_ID = "wallet";

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
      case Kind.Deposit:
        return LedgerDirection.Credit;
      case Kind.Bet:
      case Kind.Withdrawal:
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
    if (!PROVIDER_KINDS.includes(props.kind)) {
      const internal = Object.values(Kind).includes(props.kind);
      return Output.fail(internal ? INTERNAL_KIND_NOT_ALLOWED : INVALID_WAGER_TRANSACTION);
    }

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

  /**
   * Deposit or withdrawal of one wallet. Born PENDING and decided by the same processor as the
   * provider transactions, so balance, ledger, idempotency and events follow the same rules.
   * The client's key is scoped to the wallet: "internal:{walletId}:{key}".
   */
  static createWalletOperation(props: ICreateWalletOperationProps) {
    if (props.kind !== Kind.Deposit && props.kind !== Kind.Withdrawal) return Output.fail(INVALID_WAGER_TRANSACTION);
    if (!props.money.isPositive()) return Output.fail(INVALID_WALLET_OPERATION);

    const transaction = new WagerTransactionAggregate({
      id: IdValueObject.getDefault(),
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: `${props.kind.toLowerCase()}:${props.walletId.value}:${props.clientIdempotencyKey}`,
      idempotencyKey: WagerTransactionAggregate.walletOperationKey(props.walletId, props.clientIdempotencyKey),
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: WALLET_OPERATION_ROUND_ID,
      gameId: WALLET_OPERATION_GAME_ID,
      kind: props.kind,
      money: props.money,
      status: Status.Pending,
      referenceAttempts: 0,
    });
    if (!transaction.isValidProps()) return Output.fail(INVALID_WAGER_TRANSACTION);

    return Output.success(transaction);
  }

  /** Idempotency key stored for a wallet operation (the client's key scoped to the wallet). */
  static walletOperationKey(walletId: IdValueObject, clientIdempotencyKey: string): string {
    return `${INTERNAL_PROVIDER_ID}:${walletId.value}:${clientIdempotencyKey}`;
  }

  /** Rebuilds persisted state. Does not revalidate transitions. */
  static rehydrate(props: IWagerTransactionProps): WagerTransactionAggregate {
    return new WagerTransactionAggregate(props);
  }
}

export { WagerTransactionAggregate };
