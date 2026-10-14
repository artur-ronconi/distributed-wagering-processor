import { type MoneyProps } from "../../../domain/money/money.props";

interface ICreateWalletServiceInput {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId: string;
}

export { type ICreateWalletServiceInput };
