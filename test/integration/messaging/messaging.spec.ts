import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { IdValueObject } from "ddd-tool-kit";

import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../../support/database";
import { drain, eventually, http, startTestApp, TEST_QUEUES, testSqs, type TestApp } from "../../support/app";
import { balanceOf, createWallet, submit, wagerBody, type WalletFixture } from "../../support/api";
import { unique } from "../../support/factories";
import { WagerTransactionsConsumer } from "../../../src/presentation/sqs/wager-transactions.consumer";
import { SubmitWagerTransactionService } from "../../../src/application/use-cases/submit-wager-transaction/submit-wager-transaction.service";
import { PublishOutboxService } from "../../../src/application/use-cases/publish-outbox/publish-outbox.service";
import type { EventPublisher, PublishableEvent } from "../../../src/application/ports/event-publisher.port";
import type { Metrics } from "../../../src/application/ports/metrics.port";
import { InboxMessageAggregate } from "../../../src/domain/messaging/inbox-message/inbox-message.aggregate-root";
import { OutboxMessageAggregate } from "../../../src/domain/messaging/outbox-message/outbox-message.aggregate-root";
import { sha256 } from "../../../src/application/idempotency/canonical-payload-hash";

let app: TestApp;
let db: TestDatabase;
const sqs = testSqs();
let consumer: WagerTransactionsConsumer;

const noMetrics: Metrics = {
  transactionDecided: () => undefined,
  duplicateDetected: () => undefined,
  retry: () => undefined,
  sentToDlq: () => undefined,
  lockConflict: () => undefined,
  reconciliationMismatch: () => undefined,
  observeProcessing: () => undefined,
  eventsPublished: () => undefined,
};

beforeAll(async () => {
  db = await connectTestDatabase({ lockTimeoutMs: 300 });
  app = await startTestApp({
    lockTimeoutMs: 300,
    sqsConsumer: { maxMessages: 10, waitTimeSeconds: 1, visibilityTimeoutSeconds: 30, maxReceiveCount: 5 },
  });
  consumer = app.app.get(WagerTransactionsConsumer);
});
afterAll(async () => {
  await consumer.stop();
  await app.close();
  await db.close();
});
beforeEach(async () => {
  await consumer.stop();
  await db.truncate();
  for (const queue of Object.values(TEST_QUEUES)) await sqs.purge(queue);
});

const wagerMessage = (wallet: WalletFixture, options: Parameters<typeof wagerBody>[1] = {}, messageId = unique("msg")) => {
  const { body, idempotencyKey } = wagerBody(wallet, options);
  return {
    messageId,
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: { ...body, idempotencyKey },
  };
};

const publish = (message: ReturnType<typeof wagerMessage>, deduplicationId = unique("dedup")) =>
  sqs.send(TEST_QUEUES.wagerTransactions, message, message.data.walletId, deduplicationId);

const statusOf = async (externalTransactionId: string) =>
  (await http(app.url, "GET", `/providers/provider-a/wagering/transactions/${externalTransactionId}`)).body.status;

describe("SQS consumer (wager-transactions.fifo)", () => {
  it("processes a message with the same rules as HTTP and acks it after the commit", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    await publish(message);

    consumer.start();
    await eventually(async () => (await statusOf(message.data.externalTransactionId)) === "PROCESSED");
    await consumer.stop();

    expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
    const [inbox] = await db.sql<{ processed: boolean }>(
      `select "processed_at" is not null as processed from "inbox_messages" where "message_id" = ?`,
      [message.messageId],
    );
    expect(inbox?.processed).toBe(true);
    expect(await drain(sqs, TEST_QUEUES.wagerTransactions)).toHaveLength(0);
  });

  it("the same message published twice is applied once (inbox)", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    // different SQS deduplication ids (unique per run: FIFO dedup lasts 5 minutes), so SQS delivers both
    await publish(message, unique("first"));
    await publish(message, unique("second"));

    consumer.start();
    await eventually(async () => (await statusOf(message.data.externalTransactionId)) === "PROCESSED");
    await eventually(async () => (await drain(sqs, TEST_QUEUES.wagerTransactions)).length === 0);
    await consumer.stop();

    expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
    expect(await db.sql(`select 1 from "inbox_messages"`)).toHaveLength(1);
    const metrics = (await http(app.url, "GET", "/metrics")).body as string;
    expect(metrics).toMatch(/wagering_duplicates_total\{source="inbox"\} [1-9]/);
  });

  it("the same operation via HTTP and via SQS is applied once (idempotency key)", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    const viaHttp = await http(app.url, "POST", "/wagering/transactions", { ...message.data, idempotencyKey: undefined }, {
      "Idempotency-Key": message.data.idempotencyKey,
    });
    expect(viaHttp.status).toBe(201);

    await publish(message);
    consumer.start();
    await eventually(async () => (await db.sql(`select 1 from "inbox_messages" where "processed_at" is not null`)).length === 1);
    await consumer.stop();

    expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
  });

  it("worker killed after the commit and before the ack: the redelivery is only acked", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    await publish(message);

    // "worker A" receives the message, commits the effect and dies before DeleteMessage
    const [received] = await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 2);
    expect(received).toBeDefined();
    const inbox = InboxMessageAggregate.receive({
      messageId: message.messageId,
      consumerName: "wager-transactions-consumer",
      payloadHash: sha256(received!.Body ?? ""),
    }).result as InboxMessageAggregate;
    const committed = await app.app
      .get(SubmitWagerTransactionService)
      .executeFromMessage({ ...message.data, correlationId: message.messageId }, inbox);
    expect(committed.isSuccess).toBe(true);

    // after the visibility timeout SQS redelivers it to "worker B"
    await Bun.sleep(2_500);
    const [redelivered] = await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 30);
    expect(Number(redelivered?.Attributes?.ApproximateReceiveCount)).toBeGreaterThanOrEqual(2);
    expect(await consumer.handle(redelivered!)).toBe("ack");

    expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
    expect(await drain(sqs, TEST_QUEUES.wagerTransactions)).toHaveLength(0);
    await expectLedgerMatchesBalances(db);
  });

  it("a transient failure is not acked: the message comes back and succeeds later", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    await publish(message);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = db.uow.transactional(async () => {
      await db.wallets.findByIdForUpdate({ value: wallet.id } as never);
      await held;
    });
    await Bun.sleep(100);

    const [first] = await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 30);
    expect(await consumer.handle(first!)).toBe("retry"); // lock timeout → TRANSIENT_FAILURE
    release();
    await holder;

    expect(await sqs.receive(TEST_QUEUES.wagerTransactions, 1)).toHaveLength(0); // invisible during backoff
    const second = await eventually(async () => (await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 30))[0], 10_000);
    expect(await consumer.handle(second)).toBe("ack");
    expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
  });

  it.each([
    ["MALFORMED_MESSAGE", () => "{not json"],
    ["INVALID_PAYLOAD", (wallet: WalletFixture) => wagerMessage(wallet, { amount: "30" })],
    ["WALLET_NOT_FOUND", () => wagerMessage({ id: "aaaaaaaaaaaaaaaa", playerId: "p" })],
  ] as const)("permanent error %s goes to the DLQ and stores nothing", async (code, build) => {
    const wallet = await createWallet(app.url, "100.00");
    const body = build(wallet);
    // unique group: an unacked message in a FIFO group blocks the whole group
    await sqs.send(TEST_QUEUES.wagerTransactions, body, unique("group"), unique("dedup"));

    const [received] = await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 30);
    expect(await consumer.handle(received!)).toBe("dlq");

    const [dead] = await drain(sqs, TEST_QUEUES.wagerTransactionsDlq);
    expect(dead?.MessageAttributes?.failureCode?.StringValue).toBe(code);
    expect(await drain(sqs, TEST_QUEUES.wagerTransactions)).toHaveLength(0);
    expect(await db.sql(`select 1 from "inbox_messages"`)).toHaveLength(0);
    expect(await balanceOf(app.url, wallet.id)).toBe("100.00");
  });

  it("a business rejection is acked (final result stored), not sent to the DLQ", async () => {
    const wallet = await createWallet(app.url, "10.00");
    const message = wagerMessage(wallet, { amount: "30.00" });
    await publish(message);

    const [received] = await sqs.receive(TEST_QUEUES.wagerTransactions, 1, 30);
    expect(await consumer.handle(received!)).toBe("ack");
    expect(await statusOf(message.data.externalTransactionId)).toBe("REJECTED");
    expect(await drain(sqs, TEST_QUEUES.wagerTransactionsDlq)).toHaveLength(0);
  });

  it("on stop, received messages that were not started become visible again", async () => {
    const wallet = await createWallet(app.url, "100.00");
    for (let i = 0; i < 3; i += 1) await publish(wagerMessage(wallet, { amount: "1.00" }));

    const received = await sqs.receive(TEST_QUEUES.wagerTransactions, 10, 60);
    expect(received.length).toBeGreaterThan(0);
    await (consumer as unknown as { releaseUnstarted(m: typeof received): Promise<void> }).releaseUnstarted(received);

    expect((await drain(sqs, TEST_QUEUES.wagerTransactions)).length).toBe(received.length);
  });
});

describe("outbox publisher", () => {
  const enqueueEvents = async (count: number) => {
    await db.uow.transactional(async () => {
      for (let i = 0; i < count; i += 1) {
        await db.outbox.insert(
          OutboxMessageAggregate.enqueue({
            eventId: IdValueObject.getDefault().value,
            eventType: "WalletBalanceChanged",
            aggregateId: IdValueObject.getDefault().value,
            occurredAt: new Date(Date.now() - 1_000),
            toJSON: () => ({ i }),
          }).result as OutboxMessageAggregate,
        );
      }
    });
  };

  const publisherWith = (eventPublisher: EventPublisher, batchSize = 5) =>
    new PublishOutboxService(db.uow, db.outbox, eventPublisher, noMetrics, {
      outboxPublisher: { batchSize, intervalMs: 10 },
    });

  it("publishes the committed events to the SQS events queue", async () => {
    const wallet = await createWallet(app.url, "100.00");
    await submit(app.url, wallet, { amount: "10.00" });

    const published = await app.app.get(PublishOutboxService).execute();
    expect(published).toBe(4); // OPENING (2) + BET (2)

    const messages = await drain(sqs, TEST_QUEUES.events);
    const types = messages.map((m) => m.MessageAttributes?.eventType?.StringValue).sort();
    expect(types).toEqual(["WagerTransactionProcessed", "WagerTransactionProcessed", "WalletBalanceChanged", "WalletBalanceChanged"]);
    const body = JSON.parse(messages[0]!.Body!) as { eventId: string; data: unknown };
    expect(body.eventId).toHaveLength(16);
    expect(await db.sql(`select 1 from "outbox_messages" where "published_at" is null`)).toHaveLength(0);
  });

  it("two publishers on the same outbox never publish the same row twice", async () => {
    await enqueueEvents(40);
    const published: string[] = [];
    const slowPublisher: EventPublisher = {
      publish: async (event: PublishableEvent) => {
        await Bun.sleep(5);
        published.push(event.eventId);
      },
    };
    const a = publisherWith(slowPublisher);
    const b = publisherWith(slowPublisher);

    const run = async (publisher: PublishOutboxService) => {
      while ((await publisher.execute()) > 0) {
        // keep draining
      }
    };
    await Promise.all([run(a), run(b), run(a)]);

    expect(published).toHaveLength(40);
    expect(new Set(published).size).toBe(40);
  });

  it("a failed publish schedules a retry with backoff and succeeds later", async () => {
    await enqueueEvents(1);
    let fail = true;
    const flaky: EventPublisher = {
      publish: async () => {
        if (fail) throw new Error("SQS unavailable");
      },
    };

    expect(await publisherWith(flaky).execute()).toBe(0);
    const [row] = await db.sql<{ attempts: number; due_in_ms: number }>(
      `select "attempts", (extract(epoch from "next_attempt_at" - now()) * 1000)::int as due_in_ms from "outbox_messages"`,
    );
    expect(row?.attempts).toBe(1);
    expect(row?.due_in_ms).toBeGreaterThan(0);

    fail = false;
    await Bun.sleep(1_100);
    expect(await publisherWith(flaky).execute()).toBe(1);
  });
});
