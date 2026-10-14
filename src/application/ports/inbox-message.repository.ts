import { InboxMessageAggregate } from "../../domain/messaging/inbox-message/inbox-message.aggregate-root";

const INBOX_MESSAGE_REPOSITORY = Symbol("INBOX_MESSAGE_REPOSITORY");

interface InboxMessageRepository {
  /** INSERT ... ON CONFLICT (consumer_name, message_id) DO NOTHING. true = new message. */
  tryRegister(message: InboxMessageAggregate): Promise<boolean>;
  /** Persists processed_at / updated_at. */
  save(message: InboxMessageAggregate): Promise<void>;
}

export { INBOX_MESSAGE_REPOSITORY, InboxMessageRepository };
