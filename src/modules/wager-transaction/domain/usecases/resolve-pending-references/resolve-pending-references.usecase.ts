import { Inject, Injectable, Logger } from "@nestjs/common";
import { DateValueObject } from "ddd-tool-kit";

import { APP_CONFIG, type AppConfig } from "../../../../../config/app-config";
import { METRICS, type Metrics } from "../../../../../shared/services/metrics.service";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/services/unit-of-work.service";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../services/wager-transaction.repository";
import { WALLET_REPOSITORY, type WalletRepository } from "../../../../wallet/domain/services/wallet.repository";
import { WagerTransactionProcessor } from "../process-wager-transaction/wager-transaction.processor";
import { FailureCode } from "../../../../../shared/domain/failure-code";

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

      const expectedVersion = wallet.version;
      const decision = await this.processor.decide(tx, wallet, now);
      const entry = decision.outcome === "decided" ? decision.entry : null;

      if (decision.outcome === "reference-missing") {
        const { maxAttempts, baseDelayMs, maxDelayMs } = this.config.pendingReference;
        if (tx.referenceAttempts + 1 >= maxAttempts) {
          tx.reject(FailureCode.ReferenceNotFound, date(now));
        } else {
          const delay = Math.min(baseDelayMs * 2 ** (tx.referenceAttempts + 1), maxDelayMs);
          tx.scheduleReferenceRetry(date(new Date(now.getTime() + delay)));
          this.metrics.retry("pending_reference");
        }
      }

      await this.transactions.save(tx);
      if (entry) await this.wallets.save(wallet, expectedVersion);
      if (tx.isTerminal()) {
        const ctx = { correlationId: `pending-reference:${tx.id.value}`, causationId: tx.id.value, now };
        await this.processor.enqueue(this.processor.eventsFor(tx, wallet, entry, ctx));
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
