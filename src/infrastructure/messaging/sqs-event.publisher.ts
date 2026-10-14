import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/app-config";
import { type EventPublisher, type PublishableEvent } from "../../application/ports/event-publisher.port";
import { QueueUrlResolver, SQS_CLIENT } from "./sqs.client";

/**
 * Publishes integration events to the FIFO events queue.
 * MessageGroupId = aggregateId keeps per-wallet / per-transaction order;
 * MessageDeduplicationId = eventId drops re-publications inside SQS's 5-minute window
 * (an optimization: consumers still deduplicate by eventId).
 */
@Injectable()
class SqsEventPublisher implements EventPublisher {
  private readonly queues: QueueUrlResolver;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "queues">,
  ) {
    this.queues = new QueueUrlResolver(sqs);
  }

  async publish(event: PublishableEvent): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: await this.queues.resolve(this.config.queues.events),
        MessageBody: JSON.stringify(event.payload),
        MessageGroupId: event.aggregateId,
        MessageDeduplicationId: event.eventId,
        MessageAttributes: {
          eventType: { DataType: "String", StringValue: event.eventType },
          eventId: { DataType: "String", StringValue: event.eventId },
        },
      }),
    );
  }
}

export { SqsEventPublisher };
