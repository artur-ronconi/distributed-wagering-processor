import { Inject, Injectable, Logger } from "@nestjs/common";
import { DateValueObject } from "ddd-tool-kit";

import { APP_CONFIG, type AppConfig } from "../../../../../config/app-config";
import { EVENT_PUBLISHER, type EventPublisher } from "../../interfaces/event-publisher.interface";
import { METRICS, type Metrics } from "../../../../../shared/interfaces/metrics.interface";
import { OUTBOX_MESSAGE_REPOSITORY, type OutboxMessageRepository } from "../../interfaces/outbox-message.repository";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/interfaces/unit-of-work.interface";

/**
 * Worker use case: publishes due outbox rows. Rows are locked with FOR UPDATE SKIP LOCKED, so N
 * instances share the work without publishing the same row at the same time. Delivery is
 * at-least-once: if the process dies after publishing and before the commit, another instance
 * publishes again and consumers deduplicate by eventId (FIFO MessageDeduplicationId = eventId too).
 */
@Injectable()
class PublishOutboxUseCase {
  private readonly logger = new Logger(PublishOutboxUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_MESSAGE_REPOSITORY) private readonly outbox: OutboxMessageRepository,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "outboxPublisher">,
  ) {}

  /** Publishes one batch. Returns how many messages were published. */
  async execute(now: Date = new Date()): Promise<number> {
    return this.uow.transactional(async () => {
      const batch = await this.outbox.lockDueBatch(now, this.config.outboxPublisher.batchSize);
      let published = 0;

      for (const message of batch) {
        try {
          await this.publisher.publish({
            eventId: message.id.value,
            eventType: message.eventType,
            aggregateId: message.aggregateId,
            payload: message.payload,
          });
          message.markPublished(DateValueObject.getDefault());
          published += 1;
        } catch (error) {
          message.scheduleRetry(new Date());
          this.metrics.retry("outbox_publish");
          this.logger.warn(
            { eventId: message.id.value, attempts: message.attempts, err: (error as Error).message },
            "outbox publish failed, scheduled retry",
          );
        }
        await this.outbox.save(message);
      }

      if (published > 0) this.metrics.eventsPublished(published);
      return published;
    });
  }
}

export { PublishOutboxUseCase };
