import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../support/database";
import { drain, eventually, http, startTestApp, TEST_QUEUES, testSqs, type TestApp } from "../support/app";
import { balanceOf, createWallet, submit, wagerBody } from "../support/api";
import { startInstance, type Instance } from "../support/processes";
import { unique } from "../support/factories";

let app: TestApp;
let db: TestDatabase;
const sqs = testSqs();

beforeAll(async () => {
  db = await connectTestDatabase();
  app = await startTestApp({ databasePoolMax: 40 });
});
afterAll(async () => {
  await app.close();
  await db.close();
});
beforeEach(async () => {
  await db.truncate();
  for (const queue of Object.values(TEST_QUEUES)) await sqs.purge(queue);
});

const countDebits = async (walletId: string) =>
  (await db.sql<{ n: number }>(
    `select count(*)::int as n from "wallet_ledger_entries" where "wallet_id" = ? and "direction" = 'DEBIT'`,
    [walletId],
  ))[0]?.n;

describe("concurrency (real parallelism)", () => {
  it("1. the same bet sent 50 times in parallel debits once", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const { body, idempotencyKey } = wagerBody(wallet, { amount: "10.00" });

    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        http(app.url, "POST", "/wagering/transactions", body, { "Idempotency-Key": idempotencyKey }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(49);
    expect(new Set(responses.map((r) => r.body.transactionId)).size).toBe(1);
    expect(await countDebits(wallet.id)).toBe(1);
    expect(await balanceOf(app.url, wallet.id)).toBe("90.00");
    await expectLedgerMatchesBalances(db);
  });

  it("2. balance 100.00 and two simultaneous bets of 80.00: one PROCESSED, one REJECTED", async () => {
    for (let round = 0; round < 10; round += 1) {
      const wallet = await createWallet(app.url, "100.00");
      const [a, b] = await Promise.all([
        submit(app.url, wallet, { amount: "80.00" }),
        submit(app.url, wallet, { amount: "80.00" }),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 422]);
      expect([a.body.failureCode, b.body.failureCode]).toContain("INSUFFICIENT_FUNDS");
      expect(await balanceOf(app.url, wallet.id)).toBe("20.00");
      expect(await countDebits(wallet.id)).toBe(1);

      // retrying both changes nothing
      const retries = await Promise.all([
        submit(app.url, wallet, { amount: "80.00", externalTransactionId: a.request.externalTransactionId }),
        submit(app.url, wallet, { amount: "80.00", externalTransactionId: b.request.externalTransactionId }),
      ]);
      expect(retries.every((r) => r.body.idempotentReplay)).toBe(true);
      expect(await countDebits(wallet.id)).toBe(1);
    }
    await expectLedgerMatchesBalances(db);
  });

  it("3. different wallets are processed in parallel and stay correct", async () => {
    const wallets = await Promise.all(Array.from({ length: 20 }, () => createWallet(app.url, "100.00")));

    const responses = await Promise.all(
      wallets.flatMap((wallet) => Array.from({ length: 10 }, () => submit(app.url, wallet, { amount: "7.00" }))),
    );

    // 14 × 7.00 = 98.00 ≤ 100.00, so every one of the 10 bets fits
    expect(responses.every((r) => r.status === 201)).toBe(true);
    for (const wallet of wallets) expect(await balanceOf(app.url, wallet.id)).toBe("30.00");
    await expectLedgerMatchesBalances(db);
  });

  it("a hot wallet under a burst never goes negative", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const responses = await Promise.all(Array.from({ length: 60 }, () => submit(app.url, wallet, { amount: "5.00" })));

    expect(responses.filter((r) => r.status === 201)).toHaveLength(20);
    expect(responses.filter((r) => r.status === 422)).toHaveLength(40);
    expect(await balanceOf(app.url, wallet.id)).toBe("0.00");
    await expectLedgerMatchesBalances(db);
  });

  it("7. REFUND and ROLLBACK delivered before their reference, racing with it", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const { app: worker } = { app: await startTestApp({ run: { http: true, sqsConsumer: false, outboxPublisher: false, pendingReferenceWorker: true }, pendingReference: { intervalMs: 50, batchSize: 50, maxAttempts: 20, baseDelayMs: 50, maxDelayMs: 200 } }) };

    try {
      const bets = Array.from({ length: 10 }, () => unique("bet"));
      const results = await Promise.all(
        bets.flatMap((betId, i) => [
          submit(worker.url, wallet, { kind: i % 2 ? "REFUND" : "ROLLBACK", amount: "5.00", reference: betId }),
          Bun.sleep(5).then(() => submit(worker.url, wallet, { amount: "5.00", externalTransactionId: betId })),
        ]),
      );
      expect(results.every((r) => [201, 202].includes(r.status))).toBe(true);

      await eventually(async () => {
        const [row] = await db.sql<{ n: number }>(
          `select count(*)::int as n from "wager_transactions" where "status" = 'PENDING_REFERENCE'`,
        );
        return row?.n === 0;
      }, 20_000);
      expect(await balanceOf(worker.url, wallet.id)).toBe("100.00");
      await expectLedgerMatchesBalances(db);
    } finally {
      await worker.close();
    }
  });
});

describe("multiple instances (separate processes)", () => {
  let instances: Instance[] = [];

  afterAll(async () => {
    await Promise.all(instances.map((instance) => instance.kill("SIGKILL")));
  });

  it("4. three instances (started together, one migration run) keep a hot wallet and idempotency correct", async () => {
    instances = await Promise.all([3101, 3102, 3103].map((port) => startInstance(port)));
    const wallet = await createWallet(instances[0]!.url, "100.00");

    // the same request on every instance at once → a single debit
    const { body, idempotencyKey } = wagerBody(wallet, { amount: "10.00" });
    const same = await Promise.all(
      instances.flatMap((instance) =>
        Array.from({ length: 10 }, () =>
          http(instance.url, "POST", "/wagering/transactions", body, { "Idempotency-Key": idempotencyKey }),
        ),
      ),
    );
    expect(same.filter((r) => r.status === 201)).toHaveLength(1);
    expect(same.filter((r) => r.status === 200)).toHaveLength(29);

    // 45 bets of 2.00 spread over the instances: exactly 45 fit in the remaining 90.00
    const burst = await Promise.all(
      Array.from({ length: 60 }, (_, i) => submit(instances[i % 3]!.url, wallet, { amount: "2.00" })),
    );
    expect(burst.filter((r) => r.status === 201)).toHaveLength(45);
    expect(burst.filter((r) => r.status === 422)).toHaveLength(15);
    expect(await balanceOf(instances[2]!.url, wallet.id)).toBe("0.00");
    await expectLedgerMatchesBalances(db);

    // the outbox is drained by the three publishers, every row exactly once
    await eventually(async () => (await db.sql(`select 1 from "outbox_messages" where "published_at" is null`)).length === 0, 20_000);
    const rows = await db.sql<{ n: number }>(`select count(*)::int as n from "outbox_messages"`);
    const events = await drain(sqs, TEST_QUEUES.events);
    const eventIds = events.map((m) => (JSON.parse(m.Body!) as { eventId: string }).eventId);
    expect(new Set(eventIds).size).toBe(rows[0]!.n);
  });

  it("5/8. SQS burst across three consumers survives a SIGKILL and a restart: each message applied once", async () => {
    if (instances.length === 0) instances = await Promise.all([3101, 3102, 3103].map((port) => startInstance(port)));
    const wallets = await Promise.all(Array.from({ length: 5 }, () => createWallet(instances[0]!.url, "1000.00")));

    const messages = wallets.flatMap((wallet) =>
      Array.from({ length: 60 }, () => {
        const { body, idempotencyKey } = wagerBody(wallet, { amount: "1.00" });
        return { messageId: unique("msg"), type: "WagerTransactionRequested", data: { ...body, idempotencyKey } };
      }),
    );
    // the provider publishes while the consumers are working; the first 40 are published twice (retry)
    const publishing = (async () => {
      for (const message of [...messages, ...messages.slice(0, 40)]) {
        await sqs.send(TEST_QUEUES.wagerTransactions, message, message.data.walletId, unique("dedup"));
      }
    })();

    // kill one instance in the middle of the burst, without any chance to ack, then restart it
    await eventually(async () => {
      const [row] = await db.sql<{ n: number }>(`select count(*)::int as n from "inbox_messages"`);
      return (row?.n ?? 0) >= 30;
    }, 30_000);
    await instances[1]!.kill("SIGKILL");
    const [atKill] = await db.sql<{ n: number }>(`select count(*)::int as n from "inbox_messages"`);
    expect(atKill!.n).toBeLessThan(messages.length);
    instances[1] = await startInstance(3102);
    await publishing;

    await eventually(async () => {
      const [row] = await db.sql<{ n: number }>(
        `select count(*)::int as n from "wager_transactions" where "kind" = 'BET'`,
      );
      return row?.n === messages.length;
    }, 90_000);

    for (const wallet of wallets) {
      expect(await balanceOf(instances[0]!.url, wallet.id)).toBe("940.00");
    }
    const [inbox] = await db.sql<{ n: number }>(`select count(*)::int as n from "inbox_messages"`);
    expect(inbox?.n).toBe(messages.length);
    await expectLedgerMatchesBalances(db);

    await eventually(async () => (await db.sql(`select 1 from "outbox_messages" where "published_at" is null`)).length === 0, 30_000);
  });
});
