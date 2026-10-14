import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../../support/database";
import { eventually, http, startTestApp, type TestApp } from "../../support/app";
import { balanceOf, createWallet, submit, wagerBody } from "../../support/api";

let app: TestApp;
let db: TestDatabase;

beforeAll(async () => {
  db = await connectTestDatabase();
  app = await startTestApp({
    lockTimeoutMs: 500,
    run: { http: true, sqsConsumer: false, outboxPublisher: false, pendingReferenceWorker: true },
    pendingReference: { intervalMs: 100, batchSize: 50, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 200 },
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});
beforeEach(async () => db.truncate());

const ledgerOf = (walletId: string) =>
  db.sql<{ direction: string; amount: string }>(
    `select "direction", "amount"::text from "wallet_ledger_entries" where "wallet_id" = ? order by "created_at", "id"`,
    [walletId],
  );

const eventsOf = async () =>
  (await db.sql<{ event_type: string }>(`select "event_type" from "outbox_messages" order by "created_at", "event_type"`)).map(
    (row) => row.event_type,
  );

describe("POST /wagering/transactions", () => {
  describe("each kind", () => {
    it("BET debits (201) and records a DEBIT entry and two events", async () => {
      const wallet = await createWallet(app.url, "1000.00");
      await db.sql(`delete from "outbox_messages"`);

      const response = await submit(app.url, wallet, { amount: "25.00" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        transactionId: expect.any(String),
        status: "PROCESSED",
        balance: { amount: "975.00", currency: "BRL" },
        failureCode: null,
        idempotentReplay: false,
      });
      expect((await ledgerOf(wallet.id)).at(-1)).toEqual({ direction: "DEBIT", amount: "25.00" });
      expect(await eventsOf()).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
    });

    it("WIN credits, optionally referencing its BET", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const bet = await submit(app.url, wallet, { amount: "10.00" });
      const win = await submit(app.url, wallet, { kind: "WIN", amount: "50.00", reference: bet.request.externalTransactionId });

      expect(win.status).toBe(201);
      expect(win.body.balance.amount).toBe("140.00");
      const tx = await http(app.url, "GET", `/wagering/transactions/${win.body.transactionId}`);
      expect(tx.body.referenceTransactionId).toBe(bet.body.transactionId);
    });

    it("LOSS records without moving money: no ledger entry, no WalletBalanceChanged", async () => {
      const wallet = await createWallet(app.url, "100.00");
      await db.sql(`delete from "outbox_messages"`);

      const loss = await submit(app.url, wallet, { kind: "LOSS", amount: "0.00" });

      expect(loss.status).toBe(201);
      expect(loss.body.status).toBe("PROCESSED");
      expect(loss.body.balance.amount).toBe("100.00");
      expect(await ledgerOf(wallet.id)).toHaveLength(1); // only OPENING
      expect(await eventsOf()).toEqual(["WagerTransactionProcessed"]);
      expect((await http(app.url, "GET", `/wallets/${wallet.id}`)).body.version).toBe(1);
    });

    it("REFUND credits back a PROCESSED BET once", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const bet = await submit(app.url, wallet, { amount: "40.00" });
      const refund = await submit(app.url, wallet, { kind: "REFUND", amount: "40.00", reference: bet.request.externalTransactionId });

      expect(refund.status).toBe(201);
      expect(refund.body.balance.amount).toBe("100.00");

      const second = await submit(app.url, wallet, { kind: "REFUND", amount: "40.00", reference: bet.request.externalTransactionId });
      expect(second.status).toBe(422);
      expect(second.body.failureCode).toBe("REFERENCE_ALREADY_REVERSED");
    });

    it("ROLLBACK inverts BET (credit) and WIN (debit)", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const bet = await submit(app.url, wallet, { amount: "10.00" });
      const win = await submit(app.url, wallet, { kind: "WIN", amount: "30.00" });

      const rollbackWin = await submit(app.url, wallet, { kind: "ROLLBACK", amount: "30.00", reference: win.request.externalTransactionId });
      const rollbackBet = await submit(app.url, wallet, { kind: "ROLLBACK", amount: "10.00", reference: bet.request.externalTransactionId });

      expect(rollbackWin.body.balance.amount).toBe("90.00");
      expect(rollbackBet.body.balance.amount).toBe("100.00");
      expect((await ledgerOf(wallet.id)).map((e) => e.direction)).toEqual(["CREDIT", "DEBIT", "CREDIT", "DEBIT", "CREDIT"]);
    });

    it("a BET cannot be refunded and then rolled back (one reversal per reference)", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const bet = await submit(app.url, wallet, { amount: "10.00" });
      await submit(app.url, wallet, { kind: "REFUND", amount: "10.00", reference: bet.request.externalTransactionId });

      const rollback = await submit(app.url, wallet, { kind: "ROLLBACK", amount: "10.00", reference: bet.request.externalTransactionId });
      expect(rollback.status).toBe(422);
      expect(rollback.body.failureCode).toBe("REFERENCE_ALREADY_REVERSED");
      expect(await balanceOf(app.url, wallet.id)).toBe("100.00");
    });
  });

  describe("business rejections (422, stored as REJECTED)", () => {
    it("INSUFFICIENT_FUNDS keeps balance and ledger untouched", async () => {
      const wallet = await createWallet(app.url, "100.00");
      await submit(app.url, wallet, { amount: "80.00" });
      const rejected = await submit(app.url, wallet, { amount: "80.00" });

      expect(rejected.status).toBe(422);
      expect(rejected.body).toMatchObject({ status: "REJECTED", failureCode: "INSUFFICIENT_FUNDS", balance: { amount: "20.00" } });
      expect(await ledgerOf(wallet.id)).toHaveLength(2);
      const tx = await http(app.url, "GET", `/wagering/transactions/${rejected.body.transactionId}`);
      expect(tx.body.status).toBe("REJECTED");
    });

    it("REVERSAL_WOULD_OVERDRAW is distinct from INSUFFICIENT_FUNDS", async () => {
      const wallet = await createWallet(app.url, "0.00");
      const win = await submit(app.url, wallet, { kind: "WIN", amount: "50.00" });
      await submit(app.url, wallet, { amount: "45.00" });

      const rollback = await submit(app.url, wallet, { kind: "ROLLBACK", amount: "50.00", reference: win.request.externalTransactionId });
      expect(rollback.status).toBe(422);
      expect(rollback.body.failureCode).toBe("REVERSAL_WOULD_OVERDRAW");
      expect(await balanceOf(app.url, wallet.id)).toBe("5.00");
    });

    it.each([
      ["CURRENCY_MISMATCH", { currency: "USD" }],
      ["WALLET_PLAYER_MISMATCH", { playerId: "someone-else" }],
    ])("%s", async (code, options) => {
      const wallet = await createWallet(app.url, "100.00");
      const response = await submit(app.url, wallet, options);
      expect(response.status).toBe(422);
      expect(response.body.failureCode).toBe(code);
    });

    it.each([
      ["REFERENCE_KIND_NOT_ALLOWED", "REFUND", "WIN", {}],
      ["REFERENCE_AMOUNT_MISMATCH", "REFUND", "BET", { amount: "5.00" }],
      ["REFERENCE_MISMATCH", "REFUND", "BET", { roundId: "round-2" }],
    ] as const)("%s", async (code, kind, referenceKind, options) => {
      const wallet = await createWallet(app.url, "100.00");
      const reference = await submit(app.url, wallet, { kind: referenceKind, amount: "10.00" });
      const response = await submit(app.url, wallet, {
        kind,
        amount: "10.00",
        reference: reference.request.externalTransactionId,
        ...options,
      });
      expect(response.status).toBe(422);
      expect(response.body.failureCode).toBe(code);
    });
  });

  describe("idempotency", () => {
    it("an identical request replays the original result, with the balance of that moment", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const first = await submit(app.url, wallet, { amount: "10.00", externalTransactionId: "bet-1" });
      await submit(app.url, wallet, { amount: "20.00" });

      const replay = await submit(app.url, wallet, { amount: "10.00", externalTransactionId: "bet-1" });

      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });
      expect(replay.body.balance.amount).toBe("90.00");
      expect(await balanceOf(app.url, wallet.id)).toBe("70.00");
    });

    it("a replay of a rejected transaction answers the same 422", async () => {
      const wallet = await createWallet(app.url, "10.00");
      const first = await submit(app.url, wallet, { amount: "50.00", externalTransactionId: "bet-x" });
      const replay = await submit(app.url, wallet, { amount: "50.00", externalTransactionId: "bet-x" });

      expect(replay.status).toBe(422);
      expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });
    });

    it("the same key with a different payload is 409 and stores nothing", async () => {
      const wallet = await createWallet(app.url, "100.00");
      await submit(app.url, wallet, { amount: "10.00", externalTransactionId: "bet-1" });

      const conflict = await submit(app.url, wallet, { amount: "11.00", externalTransactionId: "bet-1" });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(await balanceOf(app.url, wallet.id)).toBe("90.00");
    });

    it("the same provider id under another key is a conflict too", async () => {
      const wallet = await createWallet(app.url, "100.00");
      await submit(app.url, wallet, { externalTransactionId: "bet-1", idempotencyKey: "key-a" });
      const conflict = await submit(app.url, wallet, { externalTransactionId: "bet-1", idempotencyKey: "key-b" });
      expect(conflict.status).toBe(409);
    });
  });

  describe("validation and errors", () => {
    it("400 without Idempotency-Key", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const { body } = wagerBody(wallet);
      const response = await http(app.url, "POST", "/wagering/transactions", body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_PAYLOAD");
    });

    it.each([
      ["OPENING", { kind: "OPENING" }, "INVALID_PAYLOAD"],
      ["unknown kind", { kind: "JACKPOT" }, "INVALID_PAYLOAD"],
      ["REFUND without reference", { kind: "REFUND" }, "INVALID_PAYLOAD"],
      ["malformed money", { amount: "25" }, "INVALID_PAYLOAD"],
      ["zero BET", { amount: "0.00" }, "INVALID_AMOUNT"],
    ])("400 for %s", async (_name, options, code) => {
      const wallet = await createWallet(app.url, "100.00");
      const response = await submit(app.url, wallet, options);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(code);
    });

    it("404 for an unknown wallet (nothing stored)", async () => {
      const response = await submit(app.url, { id: "aaaaaaaaaaaaaaaa", playerId: "p" });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("WALLET_NOT_FOUND");
      expect(await db.sql(`select 1 from "wager_transactions"`)).toHaveLength(0);
    });

    it("503 with Retry-After when the wallet stays locked longer than the lock timeout", async () => {
      const wallet = await createWallet(app.url, "100.00");
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const holder = db.uow.transactional(async () => {
        await db.wallets.findByIdForUpdate({ value: wallet.id } as never);
        await held;
      });
      await Bun.sleep(100);

      const response = await submit(app.url, wallet, { amount: "1.00", externalTransactionId: "bet-locked" });
      release();
      await holder;

      expect(response.status).toBe(503);
      expect(response.body.code).toBe("TRANSIENT_FAILURE");
      expect(response.headers.get("retry-after")).toBe("1");

      // nothing was stored, so retrying with the same key after the outage processes it once
      const retry = await submit(app.url, wallet, { amount: "1.00", externalTransactionId: "bet-locked" });
      expect(retry.status).toBe(201);
      expect(await balanceOf(app.url, wallet.id)).toBe("99.00");
    });
  });

  describe("out-of-order references", () => {
    it("a ROLLBACK before its BET is 202 PENDING_REFERENCE, then PROCESSED by the worker", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const rollback = await submit(app.url, wallet, { kind: "ROLLBACK", amount: "20.00", reference: "bet-late" });

      expect(rollback.status).toBe(202);
      expect(rollback.body).toMatchObject({ status: "PENDING_REFERENCE", balance: null });

      const bet = await submit(app.url, wallet, { amount: "20.00", externalTransactionId: "bet-late" });
      expect(bet.body.balance.amount).toBe("80.00");

      const resolved = await eventually(async () => {
        const tx = await http(app.url, "GET", `/wagering/transactions/${rollback.body.transactionId}`);
        return tx.body.status === "PROCESSED" ? tx.body : null;
      });
      expect(resolved.referenceTransactionId).toBe(bet.body.transactionId);
      expect(resolved.balance.amount).toBe("100.00");
      expect(await balanceOf(app.url, wallet.id)).toBe("100.00");

      // replay of the original ROLLBACK now returns the final result
      const replay = await submit(app.url, wallet, {
        kind: "ROLLBACK",
        amount: "20.00",
        reference: "bet-late",
        externalTransactionId: rollback.request.externalTransactionId,
      });
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe("PROCESSED");
      await expectLedgerMatchesBalances(db);
    });

    it("gives up after the retry limit with REFERENCE_NOT_FOUND and an event", async () => {
      const wallet = await createWallet(app.url, "100.00");
      const refund = await submit(app.url, wallet, { kind: "REFUND", amount: "20.00", reference: "never-sent" });
      expect(refund.status).toBe(202);

      const rejected = await eventually(async () => {
        const tx = await http(app.url, "GET", `/wagering/transactions/${refund.body.transactionId}`);
        return tx.body.status === "REJECTED" ? tx.body : null;
      });
      expect(rejected.failureCode).toBe("REFERENCE_NOT_FOUND");
      expect(await eventsOf()).toContain("WagerTransactionRejected");
      expect(await balanceOf(app.url, wallet.id)).toBe("100.00");
    });
  });
});

describe("GET transactions", () => {
  it("by internal id and by provider id return the same body", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const bet = await submit(app.url, wallet, { externalTransactionId: "tx-lookup" });

    const byId = await http(app.url, "GET", `/wagering/transactions/${bet.body.transactionId}`);
    const byProvider = await http(app.url, "GET", `/providers/provider-a/wagering/transactions/tx-lookup`);

    expect(byId.status).toBe(200);
    expect(byProvider.body).toEqual(byId.body);
    expect(byId.body).toMatchObject({
      kind: "BET",
      status: "PROCESSED",
      money: { amount: "25.00", currency: "BRL" },
      balance: { amount: "75.00", currency: "BRL" },
      failureCode: null,
      referenceTransactionId: null,
    });
    expect(byId.body.idempotencyKey).toBeUndefined();
    expect(byId.body.payloadHash).toBeUndefined();
  });

  it("the same externalTransactionId under two providers are different transactions", async () => {
    const wallet = await createWallet(app.url, "100.00");
    await submit(app.url, wallet, { providerId: "provider-a", externalTransactionId: "123", amount: "1.00" });
    await submit(app.url, wallet, { providerId: "provider-b", externalTransactionId: "123", amount: "2.00" });

    expect((await http(app.url, "GET", "/providers/provider-a/wagering/transactions/123")).body.money.amount).toBe("1.00");
    expect((await http(app.url, "GET", "/providers/provider-b/wagering/transactions/123")).body.money.amount).toBe("2.00");
  });

  it("404 and 400", async () => {
    expect((await http(app.url, "GET", "/wagering/transactions/aaaaaaaaaaaaaaaa")).body.code).toBe("TRANSACTION_NOT_FOUND");
    expect((await http(app.url, "GET", "/wagering/transactions/short")).status).toBe(400);
    expect((await http(app.url, "GET", "/providers/p/wagering/transactions/missing")).status).toBe(404);
  });
});
