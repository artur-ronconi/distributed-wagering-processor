> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _ORM: **MikroORM** (OLD_README §4). Prisma is out of scope._
>
> _Rules:_
> _- The repository interface is a **port** in the application layer. The MikroORM implementation lives in infrastructure._
> _- **A repository never opens a transaction.** The service opens one through the `UnitOfWork` port, so inbox, transaction, wallet, ledger and outbox are committed together (OLD_README §6.5 and §11)._
> _- No `read → calculate → update` without concurrency control (OLD_README §5.7). Lock the row (`findByIdForUpdate`) and/or update conditioned on `version`._
> _- Only aggregate roots have a repository. Child entities are saved **through** the root's repository (e.g. `WalletRepository.save` also inserts the wallet's new ledger entries). For large append-only children, the aggregate holds only the **new** children; the repository inserts them and never updates, deletes or "replaces the children collection"._
> _- Read-only queries (paginated ledger, reconciliation) may skip the aggregate and return DTOs directly._
>
> _Supported flows:_
> _- **GET**: `controller → service → repository.findById → postgres → mapper.toRightSide (rehydrate) → aggregate`._
> _- **POST (create)**: `controller → service → aggregate.create → uow.transactional(repository.insert) → mapper.toLeftSide → postgres`._
> _- **Change money**: `controller/consumer → service → uow.transactional(repository.findByIdForUpdate → aggregate method in memory → repository.update + other repositories) → commit`._

## Example usage in any.service.ts

### Create flow
```ts
const createAny = AnyAggregate.create({ ... });
if (createAny.isFailure) return throwFailOutput(createAny);

const any = createAny.result as AnyAggregate;

await this.uow.transactional(async () => {
  await this.anyRepository.insert(any);
});
```

### Update flow (locks only this aggregate's row)
```ts
const output = await this.uow.transactional(async () => {
  const any = await this.anyRepository.findByIdForUpdate(id); // SELECT ... FOR UPDATE
  if (!any) return Output.fail(ANY_DOESNT_EXIST);

  const expectedVersion = any.version;
  const withdraw = any.withdraw(value); // change in memory through the aggregate
  if (withdraw.isFailure) return withdraw;

  await this.anyRepository.update(any, expectedVersion);
  return Output.success(any);
});
```

## unit-of-work.port.ts (application)
```ts
interface TransactionOptions {
  isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE"; // default: READ COMMITTED
  readOnly?: boolean;
}

interface UnitOfWork {
  transactional<T>(work: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}

export { UnitOfWork, TransactionOptions };
```

## any.repository.ts (application port)
```ts
import { IdValueObject } from "ddd-tool-kit";
import { AnyAggregate } from "../../domain/any/any.aggregate-root";

interface AnyRepository {
  findById(id: IdValueObject): Promise<AnyAggregate | null>;
  /** Must run inside uow.transactional. Locks the row until commit. */
  findByIdForUpdate(id: IdValueObject): Promise<AnyAggregate | null>;
  insert(any: AnyAggregate): Promise<void>;
  /** Fails with ConcurrencyConflictError if the stored version is not expectedVersion. */
  update(any: AnyAggregate, expectedVersion: number): Promise<void>;
}

export { AnyRepository };
```

## mikro-orm.unit-of-work.ts (infrastructure)
```ts
import { IsolationLevel } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { TransactionOptions, UnitOfWork } from "../../application/ports/unit-of-work.port";

const ISOLATION: Record<NonNullable<TransactionOptions["isolation"]>, IsolationLevel> = {
  "READ COMMITTED": IsolationLevel.READ_COMMITTED,
  "REPEATABLE READ": IsolationLevel.REPEATABLE_READ,
  SERIALIZABLE: IsolationLevel.SERIALIZABLE,
};

class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly em: EntityManager) {}

  // Inside the callback, MikroORM's transaction context makes the injected EntityManager
  // in every repository resolve to the same transactional fork.
  transactional<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    return this.em.transactional(() => work(), {
      isolationLevel: options.isolation ? ISOLATION[options.isolation] : undefined,
      readOnly: options.readOnly,
    });
  }
}

export { MikroOrmUnitOfWork };
```

## mikro-orm.any.repository.ts (infrastructure)
```ts
import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { IBidirectionalMapper, IdValueObject } from "ddd-tool-kit";

import { AnyRepository } from "../../../application/ports/any.repository";
import { AnySchema, IAnySchema } from "../schemas/any.schema";
import { AnyAggregate } from "../../../domain/any/any.aggregate-root";
import { ConcurrencyConflictError } from "../errors/concurrency-conflict.error";

class AnyMikroOrmRepository implements AnyRepository {
  constructor(
    private readonly em: EntityManager,
    private readonly anyMapper: IBidirectionalMapper<IAnySchema, AnyAggregate>,
  ) {}

  async findById(id: IdValueObject): Promise<AnyAggregate | null> {
    const row = await this.em.findOne(AnySchema, { id: id.value });
    if (!row) return null;

    return this.anyMapper.toRightSide(row);
  }

  async findByIdForUpdate(id: IdValueObject): Promise<AnyAggregate | null> {
    const row = await this.em.findOne(
      AnySchema,
      { id: id.value },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    if (!row) return null;

    return this.anyMapper.toRightSide(row);
  }

  async insert(any: AnyAggregate): Promise<void> {
    await this.em.insert(AnySchema, this.anyMapper.toLeftSide(any));
  }

  async update(any: AnyAggregate, expectedVersion: number): Promise<void> {
    const { id, createdAt, ...changes } = this.anyMapper.toLeftSide(any);

    const affected = await this.em.nativeUpdate(
      AnySchema,
      { id, version: expectedVersion },
      { ...changes, updatedAt: new Date() },
    );

    if (affected === 0) throw new ConcurrencyConflictError("Any", id, expectedVersion);
  }
}

export { AnyMikroOrmRepository };
```

> _**Why `insert`/`nativeUpdate` instead of a generic `save` with delete/recreate of children?**_  
> _Every write is explicit, so it is easy to prove what each transaction does. Deleting and recreating children would violate the append-only ledger (OLD_README §5.5), and "check if exists, then create or update" is a read-then-write race between instances. The `version` condition in `update` is a safety net even when the row is already locked: if it ever affects 0 rows, something bypassed the lock._
