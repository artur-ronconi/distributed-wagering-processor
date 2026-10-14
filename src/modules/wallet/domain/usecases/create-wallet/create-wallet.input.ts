import { type MoneyProps } from "../../aggregate/value-objects/money/money.props";

interface ICreateWalletServiceInput {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId: string;
}

export { type ICreateWalletServiceInput };
