> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _Converts a domain object into a response DTO. DTOs belong to the presentation layer, not to the domain. Money always leaves as `MoneyProps` (`{ "amount": "25.00", "currency": "BRL" }`) through `toJSON()`._

## any-dto.mapper.ts
```ts
import { IUnidirectionalMapper } from "ddd-tool-kit";

import { AnyAggregate } from "../../domain/any/any.aggregate-root";
import { AnyDto } from "../dtos/any.dto";

class AnyDtoMapper implements IUnidirectionalMapper<AnyAggregate, AnyDto> {
  toRightSide(leftSide: AnyAggregate): AnyDto {
    return {
      id: leftSide.id.value,
      name: leftSide.any.value,
      amount: leftSide.amount.toJSON(),
      version: leftSide.version,
    };
  }
}

export { AnyDtoMapper };
```

## any.dto.ts
```ts
import { MoneyProps } from "../../domain/money/money.props";

interface AnyDto {
  id: string;
  name: string;
  amount: MoneyProps;
  version: number;
}

export { AnyDto };
```
