import { type WalletOperationKind } from "../../../../wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { type MoneyProps } from "../../aggregate/value-objects/money/money.props";

interface IMoveWalletFundsServiceInput {
  walletId: string;
  /** DEPOSIT adds money to the wallet, WITHDRAWAL takes it out. */
  operation: WalletOperationKind;
  money: MoneyProps;
  idempotencyKey: string | undefined;
  correlationId: string;
}

export { type IMoveWalletFundsServiceInput };
