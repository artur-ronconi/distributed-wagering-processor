import { DateValueObject, IBaseDomainAggregate } from "ddd-tool-kit";

interface IOutboxMessageProps extends IBaseDomainAggregate {
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: DateValueObject;
  attempts: number;
  nextAttemptAt: DateValueObject;
  publishedAt?: DateValueObject;
}

export { IOutboxMessageProps };
