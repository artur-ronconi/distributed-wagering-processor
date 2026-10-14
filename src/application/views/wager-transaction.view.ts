import { type IUnidirectionalMapper } from "ddd-tool-kit";

import { type MoneyProps } from "../../domain/money/money.props";
import { FailureCode } from "../../domain/shared/failure-code";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager-transaction/wager-transaction.enums";

/** Full representation returned by the GET routes. idempotencyKey and payloadHash stay internal. */
interface WagerTransactionView {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: WagerTransactionStatus;
  failureCode: FailureCode | null;
  /** Balance observed when the transaction was decided; null while PENDING_REFERENCE. */
  balance: MoneyProps | null;
  processedAt: string | null;
  createdAt: string;
}

/** Result of submitting a transaction (POST /wagering/transactions and the SQS consumer). */
interface WagerTransactionResultView {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps | null;
  failureCode: FailureCode | null;
  idempotentReplay: boolean;
}

class WagerTransactionViewMapper implements IUnidirectionalMapper<WagerTransactionAggregate, WagerTransactionView> {
  toRightSide(tx: WagerTransactionAggregate): WagerTransactionView {
    return {
      transactionId: tx.id.value,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId.value,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
      referenceTransactionId: tx.referenceTransactionId?.value ?? null,
      status: tx.status,
      failureCode: tx.failureCode ?? null,
      balance: tx.observedBalance?.toJSON() ?? null,
      processedAt: tx.processedAt?.value.toISOString() ?? null,
      createdAt: tx.createdAt.value.toISOString(),
    };
  }
}

const toResultView = (tx: WagerTransactionAggregate, idempotentReplay: boolean): WagerTransactionResultView => ({
  transactionId: tx.id.value,
  status: tx.status,
  balance: tx.observedBalance?.toJSON() ?? null,
  failureCode: tx.failureCode ?? null,
  idempotentReplay,
});

export { type WagerTransactionView, type WagerTransactionResultView, WagerTransactionViewMapper, toResultView };
