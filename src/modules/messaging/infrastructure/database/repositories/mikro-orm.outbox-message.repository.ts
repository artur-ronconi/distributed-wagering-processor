import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";

import { type OutboxMessageRepository } from "../../../domain/services/outbox-message.repository";
import { OutboxMessageAggregate } from "../../../domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root";
import { OutboxMessageMapper } from "../mappers/outbox-message.mapper";
import { OutboxMessageSchema } from "../schemas/outbox-message.schema";

@Injectable()
class MikroOrmOutboxMessageRepository implements OutboxMessageRepository {
  private readonly mapper = new OutboxMessageMapper();

  constructor(private readonly em: EntityManager) {}

  async insert(message: OutboxMessageAggregate): Promise<void> {
    await this.em.insert(OutboxMessageSchema, this.mapper.toLeftSide(message));
  }

  async lockDueBatch(now: Date, limit: number): Promise<OutboxMessageAggregate[]> {
    // FOR UPDATE SKIP LOCKED: concurrent publishers never take the same row at the same time.
    const rows = await this.em.find(
      OutboxMessageSchema,
      { publishedAt: null, nextAttemptAt: { $lte: now } },
      {
        orderBy: { occurredAt: "asc", id: "asc" },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        disableIdentityMap: true,
      },
    );
    return rows.map((row) => this.mapper.toRightSide(row));
  }

  async save(message: OutboxMessageAggregate): Promise<void> {
    const row = this.mapper.toLeftSide(message);
    await this.em.nativeUpdate(
      OutboxMessageSchema,
      { id: row.id },
      {
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      },
    );
  }
}

export { MikroOrmOutboxMessageRepository };
