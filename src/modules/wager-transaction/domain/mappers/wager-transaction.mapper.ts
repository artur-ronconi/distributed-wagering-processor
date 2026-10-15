import { type IBidirectionalMapper } from "ddd-tool-kit";

import { FailureCode } from "../../../../shared/domain/failure-code";
import { WagerTransactionAggregate } from "../aggregate/aggregate-root/wager-transaction.aggregate-root";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../aggregate/aggregate-root/wager-transaction.enums";
import { type IWagerTransactionRow } from "../../infrastructure/database/schemas/wager-transaction.schema";
import { date, id, money } from "../../../../shared/domain/mapping.helpers";

class WagerTransactionMapper implements IBidirectionalMapper<IWagerTransactionRow, WagerTransactionAggregate> {
  toRightSide(row: IWagerTransactionRow): WagerTransactionAggregate {
    const currency = row.currency.trim();

    return WagerTransactionAggregate.rehydrate({
      id: id(row.id),
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      walletId: id(row.walletId),
      playerId: row.playerId,
      roundId: row.roundId,
      gameId: row.gameId,
      kind: row.kind as WagerTransactionKind,
      money: money(row.amount, currency),
      referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
      status: row.status as WagerTransactionStatus,
      referenceTransactionId: row.referenceTransactionId ? id(row.referenceTransactionId) : undefined,
      failureCode: (row.failureCode as FailureCode | null) ?? undefined,
      observedBalance: row.observedBalanceAmount ? money(row.observedBalanceAmount, currency) : undefined,
      processedAt: row.processedAt ? date(row.processedAt) : undefined,
      referenceAttempts: row.referenceAttempts,
      nextReferenceAttemptAt: row.nextReferenceAttemptAt ? date(row.nextReferenceAttemptAt) : undefined,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
  }

  toLeftSide(tx: WagerTransactionAggregate): IWagerTransactionRow {
    return {
      id: tx.id.value,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash,
      walletId: tx.walletId.value,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      amount: tx.money.toString(),
      currency: tx.money.currency,
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
      status: tx.status,
      referenceTransactionId: tx.referenceTransactionId?.value ?? null,
      failureCode: tx.failureCode ?? null,
      observedBalanceAmount: tx.observedBalance?.toString() ?? null,
      processedAt: tx.processedAt?.value ?? null,
      referenceAttempts: tx.referenceAttempts,
      nextReferenceAttemptAt: tx.nextReferenceAttemptAt?.value ?? null,
      createdAt: tx.createdAt.value,
      updatedAt: tx.updatedAt.value,
    };
  }
}

export { WagerTransactionMapper };
