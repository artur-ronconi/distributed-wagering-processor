const EVENT_PUBLISHER = Symbol("EVENT_PUBLISHER");

interface PublishableEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
}

/** Publishes an integration event to the outside world (SQS). Must be idempotent per eventId. */
interface EventPublisher {
  publish(event: PublishableEvent): Promise<void>;
}

export { EVENT_PUBLISHER, EventPublisher, PublishableEvent };
