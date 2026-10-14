import { EntitySchema } from "@mikro-orm/core";

interface IOutboxMessageRow {
  id: string; // = eventId
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OutboxMessageSchema = new EntitySchema<IOutboxMessageRow>({
  name: "OutboxMessage",
  tableName: "outbox_messages",
  properties: {
    id: { type: "string", length: 16, primary: true },
    aggregateId: { type: "string", length: 16 },
    eventType: { type: "string" },
    payload: { type: "json" },
    occurredAt: { type: "datetime" },
    attempts: { type: "integer" },
    nextAttemptAt: { type: "datetime" },
    publishedAt: { type: "datetime", nullable: true },
    createdAt: { type: "datetime" },
    updatedAt: { type: "datetime" },
  },
});

export { OutboxMessageSchema, type IOutboxMessageRow };
