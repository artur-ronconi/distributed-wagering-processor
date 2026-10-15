import {
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

import { config } from "./config";

const sqs = new SQSClient({
  endpoint: config.aws.endpoint,
  region: config.aws.region,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const urls = new Map<string, string>();
const queueUrl = async (name: string): Promise<string> => {
  const cached = urls.get(name);
  if (cached) return cached;
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
  if (!QueueUrl) throw new Error(`queue ${name} not found`);
  urls.set(name, QueueUrl);
  return QueueUrl;
};

/** Publishes to the input queue, exactly as a game provider would. */
const sendWagerMessage = async (input: { body: string; groupId: string; deduplicationId: string }) => {
  const sentAt = new Date().toISOString();
  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: await queueUrl(config.queues.wager),
      MessageBody: input.body,
      MessageGroupId: input.groupId,
      MessageDeduplicationId: input.deduplicationId,
    }),
  );
  return { sqsMessageId: result.MessageId, sequenceNumber: result.SequenceNumber, sentAt, queue: config.queues.wager };
};

const depth = async (name: string) => {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: await queueUrl(name),
      AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    }),
  );
  return {
    queue: name,
    visible: Number(Attributes?.ApproximateNumberOfMessages ?? 0),
    inFlight: Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
  };
};

const parse = (body: string | undefined) => {
  try {
    return JSON.parse(body ?? "");
  } catch {
    return body ?? null;
  }
};

/** Looks at the DLQ without consuming it (visibility 0): the messages stay there for auditing. */
const peekDlq = async () => {
  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: await queueUrl(config.queues.dlq),
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,
      WaitTimeSeconds: 0,
      MessageAttributeNames: ["All"],
      MessageSystemAttributeNames: ["All"],
    }),
  );
  return Messages.map((message) => ({
    sqsMessageId: message.MessageId,
    failureCode: message.MessageAttributes?.failureCode?.StringValue ?? null,
    groupId: message.Attributes?.MessageGroupId ?? null,
    body: parse(message.Body),
  }));
};

interface ReceivedEvent {
  eventId: string;
  eventType: string;
  groupId: string | null;
  receivedAt: string;
  payload: unknown;
}

const received = new Map<string, ReceivedEvent>();
const MAX_KEPT = 2_000;

const keep = (message: Message) => {
  const eventId = message.MessageAttributes?.eventId?.StringValue ?? message.MessageId ?? "";
  received.set(eventId, {
    eventId,
    eventType: message.MessageAttributes?.eventType?.StringValue ?? "?",
    groupId: message.Attributes?.MessageGroupId ?? null,
    receivedAt: new Date().toISOString(),
    payload: parse(message.Body),
  });
  if (received.size > MAX_KEPT) received.delete(received.keys().next().value as string);
};

/** Downstream consumer of the outgoing events queue: keeps the last events in memory. */
const startEventsDrain = () => {
  if (!config.drainEvents) return;
  const loop = async () => {
    for (;;) {
      try {
        const url = await queueUrl(config.queues.events);
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
            MessageAttributeNames: ["All"],
            MessageSystemAttributeNames: ["MessageGroupId"],
          }),
        );
        if (Messages.length === 0) continue;
        Messages.forEach(keep);
        await sqs.send(
          new DeleteMessageBatchCommand({
            QueueUrl: url,
            Entries: Messages.map((message, index) => ({ Id: String(index), ReceiptHandle: message.ReceiptHandle })),
          }),
        );
      } catch {
        await Bun.sleep(2_000);
      }
    }
  };
  void loop();
};

const eventsByIds = (ids: string[]) => ids.map((id) => received.get(id)).filter(Boolean);
const recentEvents = (limit: number) => [...received.values()].slice(-limit).reverse();

const ping = async () => {
  await queueUrl(config.queues.wager);
  return true;
};

export { depth, eventsByIds, peekDlq, ping, recentEvents, sendWagerMessage, startEventsDrain };
