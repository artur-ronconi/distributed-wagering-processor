/** What the outbox needs from an event. IntegrationEvent (application layer) satisfies it. */
interface IOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  toJSON(): Record<string, unknown>;
}

export { IOutboxEvent };
