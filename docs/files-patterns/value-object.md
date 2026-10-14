> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _Factories follow OLD_README §6.0: private constructor + static factories. `create` validates and returns `Output`. `MoneyValueObject` is the exception that keeps the OLD_README name `from` (see @docs/domain/money.md)._

## Common usage in any.service.ts
```ts
import { throwFailOutput } from "ddd-tool-kit";
import { AnyValueObject } from "./any.value-object";

...

const createAny = AnyValueObject.create({ value: "any correspondent value" });
if (createAny.isFailure) return throwFailOutput(createAny);

const any = createAny.result as AnyValueObject;
```

## any.props.ts
```ts
import { IBaseDomainValueObject } from "ddd-tool-kit";

interface IAnyValueObject extends IBaseDomainValueObject<string> {}

export { IAnyValueObject };
```

## any.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

// `code` is the stable, machine-readable failureCode required by OLD_README §7.2 (see @docs/domain/shared.md).
const INVALID_ANY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Any must contain at most 20 characters.", // You will change this message
  statusCode: HttpStatus.BAD_REQUEST,
};

export { INVALID_ANY };
```

## any.value-object.ts
```ts
import { Output, ValueObject } from "ddd-tool-kit";
import { INVALID_ANY } from "./any.errors";
import { IAnyValueObject } from "./any.props";

class AnyValueObject extends ValueObject<IAnyValueObject> {
  private constructor(props: IAnyValueObject) {
    super(props);
  }

  protected sanitizeProps(): void {
    this.props.value = this.props.value.trim();
  }

  protected isValidProps(): boolean {
    return this.value.length <= 20;
  }

  static create(props: IAnyValueObject) {
    const any = new AnyValueObject(props);

    const isInvalidProps = !any.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_ANY);

    return Output.success(any);
  }
}

export { AnyValueObject };
```

> _**Value objects are immutable.**_  
> _Never expose setters. An operation that "changes" a value object returns a new instance (e.g. `money.add(other)`)._
