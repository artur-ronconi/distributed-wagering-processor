import { MoneyValueObject } from "../../src/domain/money/money.value-object";

export const money = (amount: string, currency: string): MoneyValueObject => {
  const output = MoneyValueObject.from({ amount, currency });
  if (output.isFailure) throw new Error(`Invalid test money: ${amount} ${currency}`);
  return output.result as MoneyValueObject;
};

export const brl = (amount: string): MoneyValueObject => money(amount, "BRL");
