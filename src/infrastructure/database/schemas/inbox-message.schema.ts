import { EntitySchema } from "@mikro-orm/core";

interface IInboxMessageRow {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  createdAt: Date; // received at
  updatedAt: Date;
  processedAt: Date | null;
}

const InboxMessageSchema = new EntitySchema<IInboxMessageRow>({
  name: "InboxMessage",
  tableName: "inbox_messages",
  properties: {
    id: { type: "string", length: 16, primary: true },
    messageId: { type: "string" },
    consumerName: { type: "string" },
    payloadHash: { type: "string", length: 64 },
    createdAt: { type: "datetime" },
    updatedAt: { type: "datetime" },
    processedAt: { type: "datetime", nullable: true },
  },
});

export { InboxMessageSchema, IInboxMessageRow };
