import { Output, ValueObject } from "ddd-tool-kit";

import { IMoneyValueObject, MoneyProps } from "./money.props";
import {
  CurrencyMismatchError,
  INVALID_MONEY_AMOUNT,
  INVALID_MONEY_CURRENCY,
} from "./money.errors";

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,16})\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

class MoneyValueObject extends ValueObject<IMoneyValueObject> {
  private constructor(props: IMoneyValueObject) {
    super(props);
  }

  get currency(): string {
    return this.props.currency;
  }

  /** Amount in cents. */
  get cents(): bigint {
    return this.props.value;
  }

  add(other: MoneyValueObject): MoneyValueObject {
    this.assertSameCurrency(other);
    return MoneyValueObject.ofCents(this.cents + other.cents, this.currency);
  }

  subtract(other: MoneyValueObject): MoneyValueObject {
    this.assertSameCurrency(other);
    return MoneyValueObject.ofCents(this.cents - other.cents, this.currency);
  }

  negate(): MoneyValueObject {
    return MoneyValueObject.ofCents(-this.cents, this.currency);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isLessThan(other: MoneyValueObject): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  equals(other: MoneyValueObject): boolean {
    return this.currency === other.currency && this.cents === other.cents;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  override toString(): string {
    const sign = this.cents < 0n ? "-" : "";
    const abs = this.cents < 0n ? -this.cents : this.cents;
    const fraction = (abs % 100n).toString().padStart(2, "0");

    return `${sign}${abs / 100n}.${fraction}`;
  }

  private assertSameCurrency(other: MoneyValueObject): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    return typeof this.props.value === "bigint" && CURRENCY_PATTERN.test(this.props.currency);
  }

  /** Validates an external contract value (API, queue, database). */
  static from(props: MoneyProps) {
    if (typeof props?.amount !== "string" || !AMOUNT_PATTERN.test(props.amount)) {
      return Output.fail(INVALID_MONEY_AMOUNT);
    }
    if (typeof props.currency !== "string" || !CURRENCY_PATTERN.test(props.currency)) {
      return Output.fail(INVALID_MONEY_CURRENCY);
    }

    const [integer = "0", fraction = "00"] = props.amount.split(".");
    const cents = BigInt(integer) * 100n + BigInt(fraction);

    return Output.success(new MoneyValueObject({ value: cents, currency: props.currency }));
  }

  static zero(currency: string): MoneyValueObject {
    return MoneyValueObject.ofCents(0n, currency);
  }

  private static ofCents(cents: bigint, currency: string): MoneyValueObject {
    return new MoneyValueObject({ value: cents, currency });
  }
}

export { MoneyValueObject };
