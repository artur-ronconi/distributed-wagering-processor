import { DateValueObject, IdValueObject } from "ddd-tool-kit";
import { MoneyValueObject } from "../../../modules/wallet/domain/aggregate/value-objects/money/money.value-object";

/** Values read from the database were validated when written; a failure here is data corruption. */
const id = (value: string): IdValueObject => {
  const output = IdValueObject.init({ value: value.trim() });
  if (output.isFailure) throw new Error(`Corrupted id in database: ${value}`);
  return output.result as IdValueObject;
};

const date = (value: Date): DateValueObject => DateValueObject.init({ value: new Date(value) }).result as DateValueObject;

const money = (amount: string, currency: string): MoneyValueObject => {
  const output = MoneyValueObject.from({ amount, currency: currency.trim() });
  if (output.isFailure) throw new Error(`Corrupted money in database: ${amount} ${currency}`);
  return output.result as MoneyValueObject;
};

export { id, date, money };
