import { type IBaseDomainValueObject } from "ddd-tool-kit";

/** Contract shape (OLD_README §6.1): decimal string with exactly 2 places. */
interface MoneyProps {
  amount: string;
  currency: string;
}

/** Internal state. `value` is the amount in cents. */
interface IMoneyValueObject extends IBaseDomainValueObject<bigint> {
  currency: string;
}

export { type MoneyProps, type IMoneyValueObject };
