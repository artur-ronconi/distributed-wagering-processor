import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";

import { type InboxMessageRepository } from "../../../application/ports/inbox-message.repository";
import { InboxMessageAggregate } from "../../../domain/messaging/inbox-message/inbox-message.aggregate-root";
import { InboxMessageMapper } from "../mappers/inbox-message.mapper";
import { InboxMessageSchema } from "../schemas/inbox-message.schema";

@Injectable()
class MikroOrmInboxMessageRepository implements InboxMessageRepository {
  private readonly mapper = new InboxMessageMapper();

  constructor(private readonly em: EntityManager) {}

  async tryRegister(message: InboxMessageAggregate): Promise<boolean> {
    const row = this.mapper.toLeftSide(message);

    const inserted = await this.em.execute<Array<{ id: string }>>(
      `insert into "inbox_messages"
         ("id", "message_id", "consumer_name", "payload_hash", "created_at", "updated_at", "processed_at")
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict ("consumer_name", "message_id") do nothing
       returning "id"`,
      [row.id, row.messageId, row.consumerName, row.payloadHash, row.createdAt, row.updatedAt, row.processedAt],
    );
    return inserted.length === 1;
  }

  async save(message: InboxMessageAggregate): Promise<void> {
    const row = this.mapper.toLeftSide(message);
    await this.em.nativeUpdate(
      InboxMessageSchema,
      { id: row.id },
      { processedAt: row.processedAt, updatedAt: row.updatedAt },
    );
  }
}

export { MikroOrmInboxMessageRepository };
