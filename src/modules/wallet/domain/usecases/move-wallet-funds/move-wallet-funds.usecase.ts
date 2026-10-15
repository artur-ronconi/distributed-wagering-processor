import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output, throwFailOutput } from "ddd-tool-kit";

import { ConcurrencyConflictError } from "../../../../../shared/errors/concurrency-conflict.error";
import { DuplicateKeyError } from "../../../../../shared/errors/duplicate-key.error";
import { INVALID_ID } from "../../../../../shared/errors/common.errors";
import { AbortTransaction, failureFrom } from "../../../../../shared/errors/service-failure";
import { canonicalize, sha256 } from "../../../../../shared/utils/canonical-hash";
import { METRICS, type Metrics } from "../../../../../shared/interfaces/metrics.interface";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/interfaces/unit-of-work.interface";
import { type IntegrationEvent } from "../../../../messaging/domain/events/integration-event";
import { WagerTransactionAggregate } from "../../../../wager-transaction/domain/aggregate/aggregate-root/wager-transaction.aggregate-root";
import { IDEMPOTENCY_CONFLICT, INVALID_WALLET_OPERATION } from "../../../../wager-transaction/domain/aggregate/aggregate-root/wager-transaction.errors";
import { WagerTransactionProcessed } from "../../../../wager-transaction/domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../../../wager-transaction/domain/events/wager-transaction-rejected.event";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../../../wager-transaction/domain/interfaces/wager-transaction.repository";
import { toResultView, type WagerTransactionResultView } from "../../../../wager-transaction/domain/mappers/wager-transaction-view.mapper";
import { WagerTransactionProcessor } from "../../../../wager-transaction/domain/usecases/process-wager-transaction/wager-transaction.processor";
import { WALLET_REPOSITORY, type WalletRepository } from "../../interfaces/wallet.repository";
import { WalletBalanceChanged } from "../../events/wallet-balance-changed.event";
import { MoneyValueObject } from "../../aggregate/value-objects/money/money.value-object";
import { WALLET_NOT_FOUND } from "../../aggregate/aggregate-root/wallet.errors";
import { type IMoveWalletFundsServiceInput } from "./move-wallet-funds.input";
import { MISSING_IDEMPOTENCY_KEY } from "./move-wallet-funds.errors";

const MAX_ATTEMPTS = 3;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

interface PreparedOperation {
  walletId: IdValueObject;
  money: MoneyValueObject;
  clientIdempotencyKey: string;
  payloadHash: string;
}

/**
 * Deposit (POST /wallets/:walletId/deposits) or withdrawal (POST /wallets/:walletId/withdrawals).
 *
 * The operation is a wager transaction of kind DEPOSIT or WITHDRAWAL decided by the same processor
 * as BET/WIN/…, so it gets the same guarantees: persistent idempotency (the client's key scoped to the
 * wallet), the wallet row lock, a balance that never goes negative (a withdrawal larger than the
 * balance is REJECTED with INSUFFICIENT_FUNDS and kept for auditing), the ledger entry and the
 * outbox events, all in one SQL transaction.
 */
@Injectable()
class MoveWalletFundsUseCase {
  private readonly logger = new Logger(MoveWalletFundsUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly processor: WagerTransactionProcessor,
  ) {}

  async execute(input: IMoveWalletFundsServiceInput): Promise<Output<WagerTransactionResultView> | Output<IError>> {
    const prepared = this.prepare(input);
    if (prepared.isFailure) return prepared as Output<IError>;
    const operation = prepared.result as PreparedOperation;

    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await this.uow.transactional(() => this.applyInTransaction(input, operation));
        if (!result.idempotentReplay) this.metrics.transactionDecided(result.status, input.operation);
        else this.metrics.duplicateDetected("idempotency_key");
        return Output.success(result);
      } catch (error) {
        // Same request twice in parallel: the loser hits a UNIQUE constraint; the retry answers as a replay.
        const isRace = error instanceof DuplicateKeyError || error instanceof ConcurrencyConflictError;
        if (isRace && attempt < MAX_ATTEMPTS) {
          this.metrics.retry("concurrency");
          continue;
        }
        if (isRace) this.metrics.lockConflict();
        return failureFrom(error, this.logger, {
          correlationId: input.correlationId,
          walletId: input.walletId,
          operation: input.operation,
        });
      }
    }
  }

  private async applyInTransaction(
    input: IMoveWalletFundsServiceInput,
    operation: PreparedOperation,
  ): Promise<WagerTransactionResultView> {
    const key = WagerTransactionAggregate.walletOperationKey(operation.walletId, operation.clientIdempotencyKey);

    // Fast path: a replay does not need the wallet lock.
    const existing = await this.transactions.findByIdempotencyKey(key);
    if (existing) return this.replay(existing, operation.payloadHash);

    const wallet = await this.wallets.findByIdForUpdate(operation.walletId);
    if (!wallet) throw new AbortTransaction(Output.fail(WALLET_NOT_FOUND));

    // An identical request may have committed while we waited for the lock.
    const committedMeanwhile = await this.transactions.findByIdempotencyKey(key);
    if (committedMeanwhile) return this.replay(committedMeanwhile, operation.payloadHash);

    const createTransaction = WagerTransactionAggregate.createWalletOperation({
      kind: input.operation,
      walletId: wallet.id,
      playerId: wallet.playerId,
      money: operation.money,
      clientIdempotencyKey: operation.clientIdempotencyKey,
      payloadHash: operation.payloadHash,
    });
    if (createTransaction.isFailure) throw new AbortTransaction(throwFailOutput(createTransaction));
    const transaction = createTransaction.result as WagerTransactionAggregate;

    const now = new Date();
    const ctx = { correlationId: input.correlationId, now };
    const expectedVersion = wallet.version;
    // Same rules as a wager: currency must match, a withdrawal never takes the balance below zero.
    const decision = await this.processor.decide(transaction, wallet, now);

    let events: IntegrationEvent<unknown>[];
    switch (decision.outcome) {
      case "processed":
        events = [WagerTransactionProcessed.from(transaction, ctx)];
        if (decision.entry) events.push(WalletBalanceChanged.from(wallet, decision.entry, ctx));
        break;
      case "rejected":
        events = [WagerTransactionRejected.from(transaction, ctx)];
        break;
      case "reference-missing":
        // Deposits and withdrawals have no reference: unreachable.
        throw new Error(`Wallet operation ${transaction.id.value} cannot wait for a reference`);
    }

    await this.transactions.insert(transaction);
    if (decision.outcome === "processed" && decision.entry) await this.wallets.save(wallet, expectedVersion);
    await this.processor.enqueue(events);

    return toResultView(transaction, false);
  }

  /** Same key: same payload → original result; different payload → conflict (nothing persisted). */
  private replay(existing: WagerTransactionAggregate, payloadHash: string): WagerTransactionResultView {
    if (!existing.matchesPayload(payloadHash)) throw new AbortTransaction(Output.fail(IDEMPOTENCY_CONFLICT));
    return toResultView(existing, true);
  }

  /** Pure validation: invalid input never opens a transaction. */
  private prepare(input: IMoveWalletFundsServiceInput): Output<PreparedOperation> | Output<IError> {
    const clientIdempotencyKey = input.idempotencyKey?.trim() ?? "";
    if (clientIdempotencyKey.length === 0 || clientIdempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return Output.fail(MISSING_IDEMPOTENCY_KEY);
    }

    const createWalletId = IdValueObject.init({ value: input.walletId ?? "" });
    if (createWalletId.isFailure) return Output.fail(INVALID_ID);
    const walletId = createWalletId.result as IdValueObject;

    const createMoney = MoneyValueObject.from(input.money);
    if (createMoney.isFailure) return throwFailOutput(createMoney);
    const money = createMoney.result as MoneyValueObject;
    if (!money.isPositive()) return Output.fail(INVALID_WALLET_OPERATION);

    return Output.success({
      walletId,
      money,
      clientIdempotencyKey,
      // Business fields only; same request → same hash, whatever the headers or the transport.
      payloadHash: sha256(
        canonicalize({ walletId: walletId.value, operation: input.operation, money: money.toJSON() }),
      ),
    });
  }
}

export { MoveWalletFundsUseCase };
