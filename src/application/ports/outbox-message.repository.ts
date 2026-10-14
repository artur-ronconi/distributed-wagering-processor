import { OutboxMessageAggregate } from "../../domain/messaging/outbox-message/outbox-message.aggregate-root";

const OUTBOX_MESSAGE_REPOSITORY = Symbol("OUTBOX_MESSAGE_REPOSITORY");

interface OutboxMessageRepository {
  insert(message: OutboxMessageAggregate): Promise<void>;
  /** Must run inside uow.transactional. Due, unpublished rows, FOR UPDATE SKIP LOCKED. */
  lockDueBatch(now: Date, limit: number): Promise<OutboxMessageAggregate[]>;
  /** Persists attempts, next_attempt_at, published_at, updated_at. */
  save(message: OutboxMessageAggregate): Promise<void>;
}

export { OUTBOX_MESSAGE_REPOSITORY, type OutboxMessageRepository };
