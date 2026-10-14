import { Inject, Injectable, Logger } from "@nestjs/common";
import { DateValueObject, IdValueObject, type IError, Output, throwFailOutput } from "ddd-tool-kit";

import { APP_CONFIG, type AppConfig } from "../../../../../config/app-config";
import { ConcurrencyConflictError } from "../../../../../shared/errors/concurrency-conflict.error";
import { DuplicateKeyError } from "../../../../../shared/errors/duplicate-key.error";
import { INVALID_ID } from "../../../../../shared/errors/common.errors";
import { wagerPayloadHash } from "./wager-payload-hash";
import { INBOX_MESSAGE_REPOSITORY, type InboxMessageRepository } from "../../../../messaging/domain/services/inbox-message.repository";
import { METRICS, type Metrics } from "../../../../../shared/services/metrics.service";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/services/unit-of-work.service";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../services/wager-transaction.repository";
import { WALLET_REPOSITORY, type WalletRepository } from "../../../../wallet/domain/services/wallet.repository";
import { AbortTransaction, failureFrom } from "../../../../../shared/errors/service-failure";
import { WagerTransactionProcessor } from "../process-wager-transaction/wager-transaction.processor";
import { toResultView, type WagerTransactionResultView } from "../../mappers/wager-transaction-view.mapper";
import { InboxMessageAggregate } from "../../../../messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root";
import { MoneyValueObject } from "../../../../wallet/domain/aggregate/value-objects/money/money.value-object";
import { WagerTransactionAggregate } from "../../aggregate/aggregate-root/wager-transaction.aggregate-root";
import { WagerTransactionKind } from "../../aggregate/aggregate-root/wager-transaction.enums";
import { IDEMPOTENCY_CONFLICT } from "../../aggregate/aggregate-root/wager-transaction.errors";
import { WALLET_NOT_FOUND } from "../../../../wallet/domain/aggregate/aggregate-root/wallet.errors";
import { type ISubmitWagerTransactionServiceInput } from "./submit-wager-transaction.input";
import { type ISubmitWagerMessageOutput, type ISubmitWagerTransactionServiceOutput } from "./submit-wager-transaction.output";
import { EXTERNAL_ID_ALREADY_USED, FIELD_TOO_LONG, MISSING_IDEMPOTENCY_KEY } from "./submit-wager-transaction.errors";

const MAX_ATTEMPTS = 3;
const MAX_EXTERNAL_FIELD_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

interface PreparedTransaction {
  transaction: WagerTransactionAggregate;
  walletId: IdValueObject;
}

/**
 * Applies a BET/WIN/LOSS/REFUND/ROLLBACK to a wallet. The same use case serves HTTP and SQS.
 *
 * Inside ONE database transaction: (inbox) → idempotency lookup → wallet row lock → idempotency
 * re-check → decide → insert transaction → save wallet + new ledger entry → outbox → COMMIT.
 * A unique-constraint race (same request in parallel) rolls back and is retried; the retry answers
 * as an idempotent replay. Invalid input never opens a transaction.
 */
@Injectable()
class SubmitWagerTransactionUseCase {
  private readonly logger = new Logger(SubmitWagerTransactionUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
    @Inject(INBOX_MESSAGE_REPOSITORY) private readonly inbox: InboxMessageRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "pendingReference">,
    private readonly processor: WagerTransactionProcessor,
  ) {}

  /** HTTP entry point. */
  async execute(
    input: ISubmitWagerTransactionServiceInput,
  ): Promise<Output<ISubmitWagerTransactionServiceOutput> | Output<IError>> {
    const output = await this.run(input, null);
    if (output.isFailure) return output as Output<IError>;

    const result = output.result as ISubmitWagerMessageOutput;
    // Without an inbox message the outcome is always a transaction result.
    return Output.success((result as { result: WagerTransactionResultView }).result);
  }

  /** SQS entry point: registers the inbox message in the same transaction. */
  async executeFromMessage(
    input: ISubmitWagerTransactionServiceInput,
    inboxMessage: InboxMessageAggregate,
  ): Promise<Output<ISubmitWagerMessageOutput> | Output<IError>> {
    return this.run(input, inboxMessage);
  }

  private async run(
    input: ISubmitWagerTransactionServiceInput,
    inboxMessage: InboxMessageAggregate | null,
  ): Promise<Output<ISubmitWagerMessageOutput> | Output<IError>> {
    const prepared = this.prepare(input);
    if (prepared.isFailure) return prepared as Output<IError>;
    const { walletId } = prepared.result as PreparedTransaction;

    for (let attempt = 1; ; attempt += 1) {
      // A fresh aggregate per attempt: a rolled-back attempt may have changed the previous one in memory.
      const { transaction } = (attempt === 1 ? prepared : this.prepare(input)).result as PreparedTransaction;

      try {
        const result = await this.uow.transactional(() =>
          this.processInTransaction(input, transaction, walletId, inboxMessage),
        );
        this.record(result, input.kind);
        return Output.success(result);
      } catch (error) {
        const isRace = error instanceof DuplicateKeyError || error instanceof ConcurrencyConflictError;
        if (isRace && attempt < MAX_ATTEMPTS) {
          this.metrics.retry("concurrency");
          continue;
        }
        if (isRace) this.metrics.lockConflict();
        return failureFrom(error, this.logger, {
          correlationId: input.correlationId,
          walletId: input.walletId,
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
        });
      }
    }
  }

  private async processInTransaction(
    input: ISubmitWagerTransactionServiceInput,
    transaction: WagerTransactionAggregate,
    walletId: IdValueObject,
    inboxMessage: InboxMessageAggregate | null,
  ): Promise<ISubmitWagerMessageOutput> {
    if (inboxMessage && !(await this.inbox.tryRegister(inboxMessage))) {
      return { duplicateMessage: true };
    }

    const finish = async (result: WagerTransactionResultView): Promise<ISubmitWagerMessageOutput> => {
      if (inboxMessage) {
        inboxMessage.markProcessed(DateValueObject.getDefault());
        await this.inbox.save(inboxMessage);
      }
      return { duplicateMessage: false, result };
    };

    // Fast path: a replay does not need the wallet lock.
    const existing = await this.transactions.findByIdempotencyKey(transaction.idempotencyKey);
    if (existing) return finish(this.replay(existing, transaction.payloadHash));

    const wallet = await this.wallets.findByIdForUpdate(walletId);
    if (!wallet) throw new AbortTransaction(Output.fail(WALLET_NOT_FOUND));

    // An identical request may have committed while we waited for the lock.
    const committedMeanwhile = await this.transactions.findByIdempotencyKey(transaction.idempotencyKey);
    if (committedMeanwhile) return finish(this.replay(committedMeanwhile, transaction.payloadHash));

    if (await this.transactions.findByExternalId(transaction.providerId, transaction.externalTransactionId)) {
      throw new AbortTransaction(Output.fail(EXTERNAL_ID_ALREADY_USED));
    }

    const now = new Date();
    const expectedVersion = wallet.version;
    const decision = await this.processor.decide(transaction, wallet, now);
    if (decision.outcome === "reference-missing") {
      transaction.markPendingReference(
        DateValueObject.init({ value: new Date(now.getTime() + this.config.pendingReference.baseDelayMs) })
          .result as DateValueObject,
      );
    }
    const entry = decision.outcome === "decided" ? decision.entry : null;

    await this.transactions.insert(transaction);
    if (entry) await this.wallets.save(wallet, expectedVersion);
    await this.processor.enqueue(
      this.processor.eventsFor(transaction, wallet, entry, {
        correlationId: input.correlationId,
        causationId: input.causationId,
        now,
      }),
    );

    return finish(toResultView(transaction, false));
  }

  /** Same key: same payload → original result; different payload → conflict (nothing persisted). */
  private replay(existing: WagerTransactionAggregate, payloadHash: string): WagerTransactionResultView {
    if (!existing.matchesPayload(payloadHash)) throw new AbortTransaction(Output.fail(IDEMPOTENCY_CONFLICT));
    return toResultView(existing, true);
  }

  /** Pure validation: invalid input never opens a transaction (and never registers the inbox). */
  private prepare(input: ISubmitWagerTransactionServiceInput): Output<PreparedTransaction> | Output<IError> {
    const idempotencyKey = input.idempotencyKey?.trim() ?? "";
    if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return Output.fail(MISSING_IDEMPOTENCY_KEY);
    }

    const externalFields = [
      input.providerId,
      input.externalTransactionId,
      input.playerId,
      input.roundId,
      input.gameId,
      input.referenceExternalTransactionId ?? "",
    ];
    if (externalFields.some((field) => typeof field === "string" && field.length > MAX_EXTERNAL_FIELD_LENGTH)) {
      return Output.fail(FIELD_TOO_LONG);
    }

    const createMoney = MoneyValueObject.from(input.money);
    if (createMoney.isFailure) return throwFailOutput(createMoney);

    const createWalletId = IdValueObject.init({ value: input.walletId ?? "" });
    if (createWalletId.isFailure) return Output.fail(INVALID_ID);

    const createTransaction = WagerTransactionAggregate.create({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey,
      payloadHash: wagerPayloadHash({
        ...input,
        referenceExternalTransactionId: input.referenceExternalTransactionId || undefined,
      }),
      walletId: createWalletId.result as IdValueObject,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind as WagerTransactionKind,
      money: createMoney.result as MoneyValueObject,
      referenceExternalTransactionId: input.referenceExternalTransactionId || undefined,
    });
    if (createTransaction.isFailure) return throwFailOutput(createTransaction);

    return Output.success({
      transaction: createTransaction.result as WagerTransactionAggregate,
      walletId: createWalletId.result as IdValueObject,
    });
  }

  private record(result: ISubmitWagerMessageOutput, kind: string): void {
    if (result.duplicateMessage) {
      this.metrics.duplicateDetected("inbox");
    } else if (result.result.idempotentReplay) {
      this.metrics.duplicateDetected("idempotency_key");
    } else {
      this.metrics.transactionDecided(result.result.status, kind);
    }
  }
}

export { SubmitWagerTransactionUseCase };
