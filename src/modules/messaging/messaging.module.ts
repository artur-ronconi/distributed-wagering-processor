import { Module } from "@nestjs/common";

import { EVENT_PUBLISHER } from "./domain/interfaces/event-publisher.interface";
import { INBOX_MESSAGE_REPOSITORY } from "./domain/interfaces/inbox-message.repository";
import { OUTBOX_MESSAGE_REPOSITORY } from "./domain/interfaces/outbox-message.repository";
import { PublishOutboxUseCase } from "./domain/usecases/publish-outbox/publish-outbox.usecase";
import { MikroOrmInboxMessageRepository } from "./infrastructure/database/repositories/mikro-orm.inbox-message.repository";
import { MikroOrmOutboxMessageRepository } from "./infrastructure/database/repositories/mikro-orm.outbox-message.repository";
import { SqsEventPublisher } from "./infrastructure/services/sqs-event.publisher";
import { OutboxPublisherProducer } from "./presentation/producers/outbox-publisher.producer";

/** Inbox (deduplication of received messages), outbox and publication of integration events. */
@Module({
  providers: [
    { provide: INBOX_MESSAGE_REPOSITORY, useClass: MikroOrmInboxMessageRepository },
    { provide: OUTBOX_MESSAGE_REPOSITORY, useClass: MikroOrmOutboxMessageRepository },
    { provide: EVENT_PUBLISHER, useClass: SqsEventPublisher },
    PublishOutboxUseCase,
    OutboxPublisherProducer,
  ],
  exports: [INBOX_MESSAGE_REPOSITORY, OUTBOX_MESSAGE_REPOSITORY, PublishOutboxUseCase],
})
class MessagingModule {}

export { MessagingModule };
