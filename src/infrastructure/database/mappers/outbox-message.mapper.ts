import { type IBidirectionalMapper } from "ddd-tool-kit";

import { OutboxMessageAggregate } from "../../../domain/messaging/outbox-message/outbox-message.aggregate-root";
import { type IOutboxMessageRow } from "../schemas/outbox-message.schema";
import { date, id } from "./mapping.helpers";

class OutboxMessageMapper implements IBidirectionalMapper<IOutboxMessageRow, OutboxMessageAggregate> {
  toRightSide(row: IOutboxMessageRow): OutboxMessageAggregate {
    return OutboxMessageAggregate.rehydrate({
      id: id(row.id),
      aggregateId: row.aggregateId.trim(),
      eventType: row.eventType,
      payload: row.payload,
      occurredAt: date(row.occurredAt),
      attempts: row.attempts,
      nextAttemptAt: date(row.nextAttemptAt),
      publishedAt: row.publishedAt ? date(row.publishedAt) : undefined,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
  }

  toLeftSide(message: OutboxMessageAggregate): IOutboxMessageRow {
    return {
      id: message.id.value,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: { ...message.payload },
      occurredAt: message.occurredAt.value,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt.value,
      publishedAt: message.publishedAt?.value ?? null,
      createdAt: message.createdAt.value,
      updatedAt: message.updatedAt.value,
    };
  }
}

export { OutboxMessageMapper };
