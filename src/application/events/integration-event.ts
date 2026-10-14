import { IdValueObject } from "ddd-tool-kit";
import { IOutboxEvent } from "../../domain/messaging/outbox-message/outbox-event.interface";

interface EventContext {
  correlationId: string; // ties every log and event of one request together
  causationId?: string;  // what directly caused it, e.g. the SQS messageId
  now: Date;
}

interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

abstract class IntegrationEvent<T> implements IOutboxEvent {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze({ ...props.data });
  }

  protected static envelope<T>(aggregateId: string, ctx: EventContext, data: T): IntegrationEventProps<T> {
    return {
      eventId: IdValueObject.getDefault().value,
      aggregateId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data,
    };
  }

  /** Serialized envelope stored in the outbox payload. */
  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data as T,
    };
  }
}

export { IntegrationEvent, IntegrationEventProps, EventContext };
