import { type MoneyProps } from "../../../domain/money/money.props";

interface ISubmitWagerTransactionServiceInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId: string;
  /** What directly caused this call, e.g. the SQS messageId. */
  causationId?: string;
}

export { type ISubmitWagerTransactionServiceInput };
