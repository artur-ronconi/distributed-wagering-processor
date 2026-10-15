> _**Observation:**_  
> _You will need to replace "Any" with the correct names when writing the files._
>
> _A service is a **use case**: `src/modules/<module>/domain/usecases/<action>/<action>.usecase.ts` (class `<Action>UseCase`). Rules:_
> _- The same service is called by the HTTP controller **and** by the SQS consumer (OLD_README §10). It never knows where the input came from._
> _- The service owns the transaction boundary through `UnitOfWork`. Everything that changes money (transaction, wallet, ledger, outbox, and inbox when called by the consumer) happens inside **one** `uow.transactional`._
> _- Integration events are created here and saved to the outbox inside the same transaction. Never publish to SQS from a service._
> _- A business rejection (e.g. insufficient funds) is **not** an exception: the wager transaction is persisted as `REJECTED` with its `failureCode`, and the transaction commits._
> _- Infrastructure errors must keep their meaning: a transient failure (database or SQS unreachable, lock timeout) is not the same as a generic 500 (OLD_README §9 status rules)._

## service.interface.ts
```ts
import { Output, IError } from "ddd-tool-kit";

// IError is any object with { statusCode: HttpStatus; message: string; }.
// Our error constants are IDomainError (IError + `code`, the stable failureCode of OLD_README §7.2).

// Output<T> is an object with: { isSuccess: boolean; isFailure: boolean; result: T }.

interface Service<I, O> {
  execute(input: I): Promise<Output<O> | Output<IError>>;
}

export { Service };
```

## withdraw-any.input.ts
```ts
import { MoneyProps } from "../../../domain/money/money.props";

interface IWithdrawAnyServiceInput {
  anyId: string;
  money: MoneyProps; // decimal string, never a number
  correlationId: string;
}

export { IWithdrawAnyServiceInput };
```

## withdraw-any.output.ts
```ts
import { MoneyProps } from "../../../domain/money/money.props";

interface IWithdrawAnyServiceOutput {
  anyId: string;
  amount: MoneyProps;
  version: number;
}

export { IWithdrawAnyServiceOutput };
```

## common.errors.ts
```ts
import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../shared/domain/failure-code";

const TRANSIENT_FAILURE: IDomainError = {
  code: FailureCode.TransientFailure,
  message: "Temporary infrastructure failure. Retry with the same Idempotency-Key.",
  statusCode: HttpStatus.SERVICE_UNAVAILABLE,
};

export { TRANSIENT_FAILURE };
```

## withdraw-any.service.ts
```ts
import { IError, IdValueObject, Output, throwFailInternalServer, throwFailOutput } from "ddd-tool-kit";

import { MoneyValueObject } from "../../../domain/money/money.value-object";
import { ANY_DOESNT_EXIST } from "../../../domain/any/any.errors";
import { TRANSIENT_FAILURE } from "../../errors/common.errors";
import { TransientInfrastructureError } from "../../errors/transient-infrastructure.error";
import { AnyChanged } from "../../events/any-changed.event";
import { OutboxMessageAggregate } from "../../../domain/messaging/outbox-message/outbox-message.aggregate-root";

class WithdrawAnyService
  implements Service<IWithdrawAnyServiceInput, IWithdrawAnyServiceOutput>
{
  constructor(
    private readonly uow: UnitOfWork,
    private readonly anyRepository: AnyRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: IWithdrawAnyServiceInput,
  ): Promise<Output<IWithdrawAnyServiceOutput> | Output<IError>> {
    try {
      const createMoney = MoneyValueObject.from(input.money);
      if (createMoney.isFailure) return throwFailOutput(createMoney);
      const money = createMoney.result as MoneyValueObject;

      const anyId = IdValueObject.init({ value: input.anyId }).result as IdValueObject;

      return await this.uow.transactional(async () => {
        const any = await this.anyRepository.findByIdForUpdate(anyId);
        if (!any) return Output.fail(ANY_DOESNT_EXIST);

        const expectedVersion = any.version;
        const withdraw = any.withdraw(money);
        if (withdraw.isFailure) return withdraw;

        const event = AnyChanged.from(any, { correlationId: input.correlationId, now: this.clock.now() });

        await this.anyRepository.update(any, expectedVersion);
        const enqueue = OutboxMessageAggregate.enqueue(event);
        if (enqueue.isFailure) return throwFailOutput(enqueue);
        await this.outboxRepository.insert(enqueue.result as OutboxMessageAggregate);

        return Output.success({
          anyId: any.id.value,
          amount: any.amount.toJSON(),
          version: any.version,
        });
      }); // COMMIT: aggregate + outbox together, or nothing
    } catch (error) {
      if (error instanceof TransientInfrastructureError) return Output.fail(TRANSIENT_FAILURE);
      return throwFailInternalServer(error);
    }
  }
}

export { WithdrawAnyService };
```

> _**Where does `TransientInfrastructureError` come from?**_  
> _Infrastructure adapters (UnitOfWork, repositories, SQS client) translate driver errors such as connection refused, lock timeout or serialization failure into `TransientInfrastructureError`. The service only knows the application-level error, never PostgreSQL error codes._
