# Money — `MoneyValueObject`

OLD_README §6.1. Convenções gerais em @docs/domain/shared.md.

## Papel

Representa **um valor monetário exato**: quantia + moeda. É a única forma de representar dinheiro no projeto. Nunca use `number`, `float` ou `double`.

## Regras

- **Contrato** (entrada e saída da API, da fila e dos eventos): string decimal com **exatamente 2 casas** + moeda ISO-4217: `{ "amount": "25.00", "currency": "BRL" }`.
- `from()` rejeita: `NaN`, `Infinity`, notação científica (`1e3`), string vazia, mais de 2 casas (`"25.005"`), menos de 2 casas (`"25"`, `"25.0"`), zeros à esquerda (`"025.00"`) e negativos (`"-1.00"`). Decisão: "escala fixa de 2" significa exigir exatamente 2 casas. Documentar no `ARCHITECTURE.md`.
- **Não arredonda.** O domínio só soma e subtrai, então nunca surge uma terceira casa. Entrada com mais de 2 casas é **rejeitada**, não arredondada.
- **Imutável:** toda operação devolve uma nova instância.
- Operar moedas diferentes **lança** `CurrencyMismatchError` (erro de programação; a `Wallet` confere a moeda antes e devolve `CURRENCY_MISMATCH` como rejeição de negócio).
- Internamente pode ser **negativo** (`negate()`, `subtract()`, a `difference` da reconciliação). "Saldo nunca negativo" é regra da `Wallet`, não do `Money`.
- Representação interna: `bigint` em **centavos**. No banco: `numeric(19,2)` + `char(3)`. Até 17 dígitos inteiros (cabe em `numeric(19,2)`).

## money.props.ts
```ts
import { IBaseDomainValueObject } from "ddd-tool-kit";

/** Contract shape (OLD_README §6.1): decimal string with exactly 2 places. */
interface MoneyProps {
  amount: string;
  currency: string;
}

/** Internal state. `value` is the amount in cents. */
interface IMoneyValueObject extends IBaseDomainValueObject<bigint> {
  currency: string;
}

export { MoneyProps, IMoneyValueObject };
```

## money.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

const INVALID_MONEY_AMOUNT: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: 'Amount must be a non-negative decimal string with exactly 2 decimal places, e.g. "25.00".',
  statusCode: HttpStatus.BAD_REQUEST,
};

const INVALID_MONEY_CURRENCY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: 'Currency must be an ISO-4217 code, e.g. "BRL".',
  statusCode: HttpStatus.BAD_REQUEST,
};

/** Programming error: the caller should have checked the currency first. */
class CurrencyMismatchError extends Error {
  constructor(expected: string, received: string) {
    super(`Cannot operate ${expected} with ${received}.`);
    this.name = "CurrencyMismatchError";
  }
}

export { INVALID_MONEY_AMOUNT, INVALID_MONEY_CURRENCY, CurrencyMismatchError };
```

## money.value-object.ts
```ts
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
```

## Uso

```ts
const createMoney = MoneyValueObject.from({ amount: "25.00", currency: "BRL" });
if (createMoney.isFailure) return throwFailOutput(createMoney);

const money = createMoney.result as MoneyValueObject;

money.add(MoneyValueObject.zero("BRL")).toJSON(); // { amount: "25.00", currency: "BRL" }
money.negate().toString();                         // "-25.00"
```

No mapper (banco → domínio), o `numeric(19,2)` chega como string (`"25.00"`), então também usa `from`:
```ts
MoneyValueObject.from({ amount: row.balanceAmount, currency: row.currency }).result as MoneyValueObject;
```

## Testes unitários obrigatórios

- `from` aceita `"0.00"`, `"25.00"`, `"99999999999999999.99"`.
- `from` rejeita `"25"`, `"25.0"`, `"25.005"`, `"025.00"`, `"-1.00"`, `"1e3"`, `"NaN"`, `"Infinity"`, `""`, `" 25.00"`, moeda `"brl"`, `"BR"`.
- `add`, `subtract`, `isLessThan` com moedas diferentes lançam `CurrencyMismatchError`.
- Imutabilidade: `a.add(b)` não altera `a`.
- `toString` de negativos e de valores menores que 1 (`"0.05"`, `"-0.05"`).
- Ida e volta: `from(x).toJSON()` é igual a `x`.
