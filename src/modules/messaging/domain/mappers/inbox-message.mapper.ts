import { type IBidirectionalMapper } from "ddd-tool-kit";

import { InboxMessageAggregate } from "../aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root";
import { type IInboxMessageRow } from "../../infrastructure/database/schemas/inbox-message.schema";
import { date, id } from "../../../../shared/domain/mapping.helpers";

class InboxMessageMapper implements IBidirectionalMapper<IInboxMessageRow, InboxMessageAggregate> {
  toRightSide(row: IInboxMessageRow): InboxMessageAggregate {
    return InboxMessageAggregate.rehydrate({
      id: id(row.id),
      messageId: row.messageId,
      consumerName: row.consumerName,
      payloadHash: row.payloadHash,
      processedAt: row.processedAt ? date(row.processedAt) : undefined,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
  }

  toLeftSide(message: InboxMessageAggregate): IInboxMessageRow {
    return {
      id: message.id.value,
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
      processedAt: message.processedAt?.value ?? null,
      createdAt: message.createdAt.value,
      updatedAt: message.updatedAt.value,
    };
  }
}

export { InboxMessageMapper };
