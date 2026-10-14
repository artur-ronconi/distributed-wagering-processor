import {
  DeleteMessageBatchCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { INestApplication } from "@nestjs/common";

import { createApp } from "../../src/bootstrap";
import { type AppConfig, loadConfig } from "../../src/config/app-config";
import { createSqsClient, QueueUrlResolver } from "../../src/infrastructure/messaging/sqs.client";
import { TEST_DATABASE_URL } from "./database";

/** Test queues created by docker/localstack/init-sqs.sh (suffix -test). */
export const TEST_QUEUES = {
  wagerTransactions: "wager-transactions-test.fifo",
  wagerTransactionsDlq: "wager-transactions-dlq-test.fifo",
  events: "wagering-events-test.fifo",
};

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const base = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
  });
  return {
    ...base,
    queues: TEST_QUEUES,
    run: { http: true, sqsConsumer: false, outboxPublisher: false, pendingReferenceWorker: false },
    ...overrides,
  };
};

export interface TestApp {
  app: INestApplication;
  url: string;
  config: AppConfig;
  close(): Promise<void>;
}

/** Real Nest application (real PostgreSQL + LocalStack), listening on a random port. */
export const startTestApp = async (overrides: Partial<AppConfig> = {}): Promise<TestApp> => {
  const config = testConfig(overrides);
  const app = await createApp(config);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { app, config, url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
};

export interface HttpResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export const http = async <T = any>(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResponse<T>> => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON (e.g. metrics)
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
};

/** Polls until `check` returns a truthy value or the timeout expires. */
export const eventually = async <T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(100);
  }
};

export const testSqs = () => {
  const sqs = createSqsClient(testConfig()) as SQSClient;
  const queues = new QueueUrlResolver(sqs);
  return {
    sqs,
    url: (name: string) => queues.resolve(name),
    /**
     * Deletes every visible message. PurgeQueue is not used on purpose: like AWS, LocalStack may
     * also delete messages sent shortly after a purge, which makes tests flaky.
     */
    purge: async (name: string) => {
      const queueUrl = await queues.resolve(name);
      for (;;) {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0, VisibilityTimeout: 30 }),
        );
        if (Messages.length === 0) return;
        await sqs.send(
          new DeleteMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: Messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
          }),
        );
      }
    },
    remove: async (name: string, messages: Message[]) => {
      if (messages.length === 0) return;
      await sqs.send(
        new DeleteMessageBatchCommand({
          QueueUrl: await queues.resolve(name),
          Entries: messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
        }),
      );
    },
    send: async (name: string, body: unknown, groupId: string, deduplicationId: string) =>
      sqs.send(
        new SendMessageCommand({
          QueueUrl: await queues.resolve(name),
          MessageBody: typeof body === "string" ? body : JSON.stringify(body),
          MessageGroupId: groupId,
          MessageDeduplicationId: deduplicationId,
        }),
      ),
    receive: async (name: string, max = 10, visibilityTimeout?: number): Promise<Message[]> =>
      (
        await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: await queues.resolve(name),
            MaxNumberOfMessages: max,
            WaitTimeSeconds: 1,
            VisibilityTimeout: visibilityTimeout,
            MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
            MessageAttributeNames: ["All"],
          }),
        )
      ).Messages ?? [],
  };
};

/**
 * Receives and deletes until the queue stays empty. Never leave received messages in flight:
 * an unacked FIFO message holds back the deliveries that follow it.
 */
export const drain = async (sqs: ReturnType<typeof testSqs>, name: string): Promise<Message[]> => {
  const all: Message[] = [];
  for (let emptyPolls = 0; emptyPolls < 2; ) {
    const batch = await sqs.receive(name, 10, 30);
    if (batch.length === 0) emptyPolls += 1;
    await sqs.remove(name, batch);
    all.push(...batch);
  }
  return all;
};
