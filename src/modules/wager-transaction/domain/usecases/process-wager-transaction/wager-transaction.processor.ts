import { Inject, Injectable } from "@nestjs/common";
import { DateValueObject, throwFailOutput } from "ddd-tool-kit";

import { type IntegrationEvent } from "../../../../messaging/domain/events/integration-event";
import { OUTBOX_MESSAGE_REPOSITORY, type OutboxMessageRepository } from "../../../../messaging/domain/interfaces/outbox-message.repository";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../interfaces/wager-transaction.repository";
import { type IDomainError } from "../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../shared/domain/failure-code";
import { OutboxMessageAggregate } from "../../../../messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root";
import { WagerTransactionAggregate } from "../../aggregate/aggregate-root/wager-transaction.aggregate-root";
import { WagerTransactionKind } from "../../aggregate/aggregate-root/wager-transaction.enums";
import { WalletAggregate } from "../../../../wallet/domain/aggregate/aggregate-root/wallet.aggregate-root";
import { INSUFFICIENT_FUNDS, REVERSAL_WOULD_OVERDRAW } from "../../../../wallet/domain/aggregate/aggregate-root/wallet.errors";
import { WalletLedgerEntryEntity } from "../../../../wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { LedgerDirection } from "../../../../wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";

type Decision =
  /** The transaction is now PROCESSED. `entry` is set when the balance changed. */
  | { outcome: "processed"; entry: WalletLedgerEntryEntity | null }
  /** The transaction is now REJECTED (`failureCode` is set). */
  | { outcome: "rejected" }
  /** The referenced transaction does not exist (yet). The caller decides: wait, retry or give up. */
  | { outcome: "reference-missing" };

/**
 * Decides and applies one wager transaction on a wallet. Shared by the HTTP route, the SQS consumer
 * and the pending-reference worker, so every entry point runs the same rules.
 * Must run inside a transaction that holds the wallet lock. Mutates `tx` and `wallet` in memory only.
 */
@Injectable()
class WagerTransactionProcessor {
  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
    @Inject(OUTBOX_MESSAGE_REPOSITORY) private readonly outbox: OutboxMessageRepository,
  ) {}

  async decide(tx: WagerTransactionAggregate, wallet: WalletAggregate, now: Date): Promise<Decision> {
    const at = DateValueObject.init({ value: now }).result as DateValueObject;
    const reject = (code: FailureCode): Decision => {
      tx.reject(code, at, wallet.balance);
      return { outcome: "rejected" };
    };

    if (wallet.playerId !== tx.playerId) return reject(FailureCode.WalletPlayerMismatch);
    if (wallet.currency !== tx.money.currency) return reject(FailureCode.CurrencyMismatch);

    let reference: WagerTransactionAggregate | null = null;
    if (tx.referenceExternalTransactionId) {
      reference = await this.transactions.findByExternalId(tx.providerId, tx.referenceExternalTransactionId);
      if (!reference) return { outcome: "reference-missing" };

      const validation = tx.validateReference(reference);
      if (validation.isFailure) return reject((validation.result as IDomainError).code);

      // Safe without extra locking: the reference belongs to this wallet, whose row we hold.
      if (tx.requiresReference() && (await this.transactions.isAlreadyReversed(reference.id))) {
        return reject(FailureCode.ReferenceAlreadyReversed);
      }
    }

    if (!tx.affectsBalance()) {
      tx.markProcessed(reference?.id, at, wallet.balance);
      return { outcome: "processed", entry: null };
    }

    const direction = tx.ledgerDirectionFor(reference ?? undefined);
    const movement =
      direction === LedgerDirection.Debit
        ? wallet.debit(
            tx.money,
            tx.id,
            tx.kind === WagerTransactionKind.Rollback ? REVERSAL_WOULD_OVERDRAW : INSUFFICIENT_FUNDS,
          )
        : wallet.credit(tx.money, tx.id);

    if (movement.isFailure) return reject((movement.result as IDomainError).code);

    tx.markProcessed(reference?.id, at, wallet.balance);
    return { outcome: "processed", entry: movement.result as WalletLedgerEntryEntity };
  }

  /** Writes the events to the outbox, in the caller's transaction. */
  async enqueue(events: IntegrationEvent<unknown>[]): Promise<void> {
    for (const event of events) {
      const enqueue = OutboxMessageAggregate.enqueue(event);
      if (enqueue.isFailure) {
        throw new Error(`Invalid outbox event: ${JSON.stringify(throwFailOutput(enqueue).result)}`);
      }
      await this.outbox.insert(enqueue.result as OutboxMessageAggregate);
    }
  }
}

export { WagerTransactionProcessor, type Decision };
