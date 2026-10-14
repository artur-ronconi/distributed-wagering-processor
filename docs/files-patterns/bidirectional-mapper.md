> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _The mapper converts the MikroORM schema shape (`IAnySchema`, see @docs/files-patterns/schema.md) ⇄ the domain aggregate. It never imports `EntityManager` nor runs queries._
>
> _`toRightSide` (database → domain) uses **`rehydrate`**, never `create`: the state is already persisted and must not be revalidated (OLD_README §6.0)._
>
> _Money is read from two columns (`amount` as a decimal string + `currency`) and rebuilt with `MoneyValueObject.from` (the database always returns `"25.00"`-shaped strings). Money is written back with `toJSON()`, never as a JS number._

## any.mapper.ts
```ts
import {
  IdValueObject,
  DateValueObject,
  IBidirectionalMapper,
} from "ddd-tool-kit";

import { IAnySchema } from "../schemas/any.schema";
import { MoneyValueObject } from "../../../domain/money/money.value-object";
import { AnyAggregate } from "../../../domain/any/any.aggregate-root";
import { AnyValueObject } from "../../../domain/any/value-objects/any/any.value-object";

class AnyMapper implements IBidirectionalMapper<IAnySchema, AnyAggregate> {
  toRightSide(leftSide: IAnySchema): AnyAggregate {
    return AnyAggregate.rehydrate({
      id: IdValueObject.init({ value: leftSide.id }).result as IdValueObject,
      any: AnyValueObject.create({ value: leftSide.name }).result as AnyValueObject,
      amount: MoneyValueObject.from({ amount: leftSide.amount, currency: leftSide.currency })
        .result as MoneyValueObject,
      version: leftSide.version,
      createdAt: DateValueObject.init({ value: leftSide.createdAt }).result as DateValueObject,
      updatedAt: DateValueObject.init({ value: leftSide.updatedAt }).result as DateValueObject,
    });
  }

  toLeftSide(rightSide: AnyAggregate): IAnySchema {
    const { amount, currency } = rightSide.amount.toJSON();

    return {
      id: rightSide.id.value,
      name: rightSide.any.value,
      amount,
      currency,
      version: rightSide.version,
      createdAt: rightSide.createdAt.value,
      updatedAt: rightSide.updatedAt.value,
    };
  }
}

export { AnyMapper };
```

> _**Append-only children (ledger)**_  
> _The `WalletAggregate` does not carry the full ledger, only the entries created in the current unit of work (`newLedgerEntries`). The `WalletLedgerEntryEntity` has its own mapper, used by `WalletRepository.save` to insert those new entries. `WalletAggregate.rehydrate` always starts with no new entries (see @docs/domain/wallet.md)._
