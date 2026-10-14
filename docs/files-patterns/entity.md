> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _Factories follow OLD_README §6.0: private constructor + static factories._
> _- `create`: builds a **new** entity, validates every rule and returns `Output`._
> _- `rehydrate`: rebuilds an entity **already persisted** (used only by the bidirectional mapper). It does **not** revalidate transition rules, it only reconstructs the stored state._

## Common usage in any.service.ts
```ts
import { throwFailOutput } from "ddd-tool-kit";

...

const createAnyValueObject = AnyValueObject.create({ value: "any correspondent value" });
if (createAnyValueObject.isFailure) return throwFailOutput(createAnyValueObject);

const anyValueObject = createAnyValueObject.result as AnyValueObject;

const createAnyEntity = AnyEntity.create({
  any: anyValueObject,
  status: AnyStatus.Pending,
});
if (createAnyEntity.isFailure) return throwFailOutput(createAnyEntity);

const anyEntity = createAnyEntity.result as AnyEntity;
```

## any.props.ts
```ts
import { IBaseDomainEntity } from "ddd-tool-kit";

import { FailureCode } from "../shared/failure-code";
import { AnyValueObject } from "./value-objects/any/any.value-object";

enum AnyStatus {
  Pending = "PENDING",
  Processed = "PROCESSED", // terminal
  Rejected = "REJECTED",   // terminal
}

interface IAnyProps extends IBaseDomainEntity {
  any: AnyValueObject;
  status: AnyStatus;
  failureCode?: FailureCode;
}

export { IAnyProps, AnyStatus };
```

## any.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

// `code` is the stable, machine-readable failureCode required by OLD_README §7.2 (see @docs/domain/shared.md).
const INVALID_ANY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid any.", // You will change this message
  statusCode: HttpStatus.BAD_REQUEST,
};

export { INVALID_ANY };
```

## any.state-error.ts
```ts
// Thrown (not returned as Output) because an invalid transition is a programming error,
// not a business path. OLD_README §6.3 calls it InvalidTransactionStateError.
class InvalidAnyStateError extends Error {
  constructor(id: string, status: string) {
    super(`Any ${id} is already in terminal status ${status}.`);
    this.name = "InvalidAnyStateError";
  }
}

export { InvalidAnyStateError };
```

## any.entity.ts
```ts
import {
  Entity,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IAnyProps, AnyStatus } from "./any.props";
import { INVALID_ANY } from "./any.errors";
import { InvalidAnyStateError } from "./any.state-error";

class AnyEntity extends Entity<IAnyProps> {
  private static readonly TERMINAL_STATUSES = [AnyStatus.Processed, AnyStatus.Rejected];

  private constructor(props: IAnyProps) {
    super(props);
  }

  get any() {
    return this.props.any;
  }

  get status() {
    return this.props.status;
  }

  get failureCode() {
    return this.props.failureCode;
  }

  isTerminal(): boolean {
    return AnyEntity.TERMINAL_STATUSES.includes(this.props.status);
  }

  // Explicit transitions. Transitioning from a terminal state is a programming error, so it throws.
  markProcessed(): void {
    this.assertNotTerminal();
    this.props.status = AnyStatus.Processed;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this.props.status = AnyStatus.Rejected;
    this.props.failureCode = code;
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) throw new InvalidAnyStateError(this.id.value, this.props.status);
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = ["any"];

    valueObjects.push(...this.defaultValueObjects);

    const requiredProps = [...valueObjects, "status"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);

    return allPropsExists && areValueObjects;
  }

  static create(props: IAnyProps) {
    const any = new AnyEntity(props);

    const isInvalidProps = !any.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_ANY);

    return Output.success(any);
  }

  /** Rebuilds persisted state. Does not revalidate transitions. */
  static rehydrate(props: IAnyProps): AnyEntity {
    return new AnyEntity(props);
  }
}

export { AnyEntity };
```

## Immutable entity variant (e.g. `WalletLedgerEntry`)

OLD_README §6.4: immutability must be **structural**, not a convention.

- No setters and no transition methods.
- Only getters. Do not expose `props`.
- `create` validates the invariant (e.g. `balanceBefore ± money === balanceAfter`) and returns `Output.fail` when it does not hold.
- `rehydrate` only reconstructs.
- The database also blocks `UPDATE`/`DELETE` on the table (see @docs/files-patterns/schema.md).
