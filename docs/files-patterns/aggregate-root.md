> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _Factories follow OLD_README §6.0: private constructor + static factories._
> _- `create` (or a domain name such as `Wallet.open`): builds a **new** aggregate, validates every rule and returns `Output`._
> _- `rehydrate`: rebuilds an aggregate **already persisted** (used only by the bidirectional mapper). It does **not** revalidate transition rules._
>
> _The aggregate is the unit of consistency and, for `Wallet`, the unit of concurrency (OLD_README §8). Business methods change state in memory; persistence and locking are the repository's job._

## Common usage in any.service.ts
```ts
import { throwFailOutput } from "ddd-tool-kit";

...

const createAnyValueObject = AnyValueObject.create({ value: "any correspondent value" });
if (createAnyValueObject.isFailure) return throwFailOutput(createAnyValueObject);

const anyValueObject = createAnyValueObject.result as AnyValueObject;

const createAnyAggregate = AnyAggregate.create({
  any: anyValueObject,
  amount: MoneyValueObject.zero("BRL"),
  version: 1,
});
if (createAnyAggregate.isFailure) return throwFailOutput(createAnyAggregate);

const anyAggregate = createAnyAggregate.result as AnyAggregate;
```

## any.props.ts
```ts
import { IBaseDomainAggregate } from "ddd-tool-kit";

import { MoneyValueObject } from "../money/money.value-object";
import { AnyValueObject } from "./value-objects/any/any.value-object";

interface IAnyProps extends IBaseDomainAggregate {
  any: AnyValueObject;
  amount: MoneyValueObject;
  version: number; // starts at 1, increments only when the state that is protected by locking changes
}

export { IAnyProps };
```

## any.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

// `code` is the stable, machine-readable failureCode required by OLD_README §7.2 (see @docs/domain/shared.md).
const INVALID_ANY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid any.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const ANY_DOESNT_EXIST: IDomainError = {
  code: FailureCode.WalletNotFound, // pick the FailureCode that matches your aggregate
  message: "Any does not exist.",
  statusCode: HttpStatus.NOT_FOUND,
};

const ANY_INSUFFICIENT_AMOUNT: IDomainError = {
  code: FailureCode.InsufficientFunds,
  message: "Amount is not enough for this operation.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

export { INVALID_ANY, ANY_DOESNT_EXIST, ANY_INSUFFICIENT_AMOUNT };
```

## any.aggregate-root.ts
```ts
import {
  Aggregate,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { MoneyValueObject } from "../money/money.value-object";
import { IAnyProps } from "./any.props";
import { INVALID_ANY, ANY_INSUFFICIENT_AMOUNT } from "./any.errors";

class AnyAggregate extends Aggregate<IAnyProps> {
  private constructor(props: IAnyProps) {
    super(props);
  }

  get any() {
    return this.props.any;
  }

  get amount() {
    return this.props.amount;
  }

  get version() {
    return this.props.version;
  }

  // Business methods: validate the rule, change state in memory, keep invariants.
  // A business rule violation returns Output.fail with a failureCode; it is not an exception.
  withdraw(value: MoneyValueObject) {
    if (this.props.amount.isLessThan(value)) return Output.fail(ANY_INSUFFICIENT_AMOUNT);

    this.props.amount = this.props.amount.subtract(value);
    this.props.version += 1;

    return Output.success(this.props.amount);
  }

  // You can add many methods that match business rules associated with this aggregate
  ...

  protected isValidProps(): boolean {
    const valueObjects = ["any"];

    valueObjects.push(...this.defaultValueObjects);

    const requiredProps = [...valueObjects, "amount", "version"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);

    return allPropsExists && areValueObjects && !this.props.amount.isNegative();
  }

  static create(props: IAnyProps) {
    const any = new AnyAggregate(props);

    const isInvalidProps = !any.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_ANY);

    return Output.success(any);
  }

  /** Rebuilds persisted state. Does not revalidate transitions. */
  static rehydrate(props: IAnyProps): AnyAggregate {
    return new AnyAggregate(props);
  }
}

export { AnyAggregate };
```

> _**Child entities**_  
> _Child entities live in the aggregate props (like `anys: AnyEntity[]`) and are validated with `verifyAreEntities`. The aggregate repository saves them; they have no repository of their own._

> _**For `Wallet`**_  
> _`debit()`/`credit()` change the balance **and** add the `WalletLedgerEntryEntity` that records it to the aggregate, so balance and ledger are always produced together (OLD_README §6.2). The aggregate only holds the entries created in this unit of work (never the whole history); `WalletRepository.save` inserts them. Full example: @docs/domain/wallet.md._
