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
