import { Inject, Injectable, Logger } from "@nestjs/common";
import { DateValueObject } from "ddd-tool-kit";

import { APP_CONFIG, type AppConfig } from "../../../../../config/app-config";
import { METRICS, type Metrics } from "../../../../../shared/interfaces/metrics.interface";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/interfaces/unit-of-work.interface";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../interfaces/wager-transaction.repository";
import { WALLET_REPOSITORY, type WalletRepository } from "../../../../wallet/domain/interfaces/wallet.repository";
import { WagerTransactionProcessor } from "../process-wager-transaction/wager-transaction.processor";
import { FailureCode } from "../../../../../shared/domain/failure-code";
import { type EventContext, type IntegrationEvent } from "../../../../messaging/domain/events/integration-event";
import { WagerTransactionProcessed } from "../../events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../events/wager-transaction-rejected.event";
import { WalletBalanceChanged } from "../../../../wallet/domain/events/wallet-balance-changed.event";

const date = (value: Date): DateValueObject => DateValueObject.init({ value }).result as DateValueObject;

/**
 * Worker use case: retries PENDING_REFERENCE transactions whose next attempt is due.
 * One small transaction per item: lock the pending row (SKIP LOCKED, so instances share the work),
 * lock its wallet, run the same processor as the HTTP route. After `maxAttempts` the transaction is
 * REJECTED with REFERENCE_NOT_FOUND and a WagerTransactionRejected event is published.
 */
@Injectable()
class ResolvePendingReferencesUseCase {
  private readonly logger = new Logger(ResolvePendingReferencesUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "pendingReference">,
    private readonly processor: WagerTransactionProcessor,
  ) {}

  /** Returns how many pending transactions were handled in this run. */
  async execute(now: Date = new Date()): Promise<number> {
    let handled = 0;
    while (handled < this.config.pendingReference.batchSize && (await this.resolveNext(now))) {
      handled += 1;
    }
    return handled;
  }

  private async resolveNext(now: Date): Promise<boolean> {
    return this.uow.transactional(async () => {
      const [tx] = await this.transactions.lockDuePendingReferences(now, 1);
      if (!tx) return false;

      const startedAt = performance.now();
      const wallet = await this.wallets.findByIdForUpdate(tx.walletId);
      if (!wallet) throw new Error(`Wallet ${tx.walletId.value} of transaction ${tx.id.value} disappeared`);

      const ctx: EventContext = { correlationId: `pending-reference:${tx.id.value}`, causationId: tx.id.value, now };
      const expectedVersion = wallet.version;
      const decision = await this.processor.decide(tx, wallet, now);

      // Still waiting for the reference: no event, the transaction stays PENDING_REFERENCE.
      let events: IntegrationEvent<unknown>[] = [];
      switch (decision.outcome) {
        case "processed":
          events = [WagerTransactionProcessed.from(tx, ctx)];
          if (decision.entry) events.push(WalletBalanceChanged.from(wallet, decision.entry, ctx));
          break;
        case "rejected":
          events = [WagerTransactionRejected.from(tx, ctx)];
          break;
        case "reference-missing": {
          const { maxAttempts, baseDelayMs, maxDelayMs } = this.config.pendingReference;
          if (tx.referenceAttempts + 1 >= maxAttempts) {
            tx.reject(FailureCode.ReferenceNotFound, date(now));
            events = [WagerTransactionRejected.from(tx, ctx)];
          } else {
            const delay = Math.min(baseDelayMs * 2 ** (tx.referenceAttempts + 1), maxDelayMs);
            tx.scheduleReferenceRetry(date(new Date(now.getTime() + delay)));
            this.metrics.retry("pending_reference");
          }
          break;
        }
      }

      await this.transactions.save(tx);
      if (decision.outcome === "processed" && decision.entry) await this.wallets.save(wallet, expectedVersion);
      await this.processor.enqueue(events);
      if (tx.isTerminal()) {
        this.metrics.transactionDecided(tx.status, tx.kind);
        this.metrics.observeProcessing("pending_reference", (performance.now() - startedAt) / 1000);
        this.logger.log(
          { transactionId: tx.id.value, walletId: wallet.id.value, status: tx.status, failureCode: tx.failureCode },
          "pending reference resolved",
        );
      }
      return true;
    });
  }
}

export { ResolvePendingReferencesUseCase };
