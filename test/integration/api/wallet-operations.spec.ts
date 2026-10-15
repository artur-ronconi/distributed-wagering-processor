import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../../support/database";
import { http, startTestApp, type TestApp } from "../../support/app";
import { balanceOf, createWallet, submit } from "../../support/api";
import { unique } from "../../support/factories";

let app: TestApp;
let db: TestDatabase;

beforeAll(async () => {
  db = await connectTestDatabase();
  app = await startTestApp();
});
afterAll(async () => {
  await app.close();
  await db.close();
});
beforeEach(async () => db.truncate());

type Operation = "deposits" | "withdrawals";

const move = (operation: Operation, walletId: string, amount: string, key: string | null = unique("key"), currency = "BRL") =>
  http(
    app.url,
    "POST",
    `/wallets/${walletId}/${operation}`,
    { money: { amount, currency } },
    key === null ? {} : { "Idempotency-Key": key },
  );

const transactionRow = async (id: string) =>
  (
    await db.sql<Record<string, string>>(
      `select "kind", "status", "provider_id", "idempotency_key", "failure_code", "amount"::text, "observed_balance_amount"::text as "observed"
       from "wager_transactions" where "id" = ?`,
      [id],
    )
  )[0];

const ledgerOf = (walletId: string) =>
  db.sql<{ direction: string; amount: string; before: string; after: string }>(
    `select "direction", "amount"::text, "balance_before_amount"::text as "before", "balance_after_amount"::text as "after"
     from "wallet_ledger_entries" where "wallet_id" = ? order by "created_at", "id"`,
    [walletId],
  );

const eventsOf = async (transactionId: string) =>
  (
    await db.sql<{ event_type: string }>(
      `select "event_type" from "outbox_messages" where "payload"->'data'->>'transactionId' = ? order by "event_type"`,
      [transactionId],
    )
  ).map((row) => row.event_type);

describe("POST /wallets/:walletId/deposits", () => {
  it("adds the amount, records a CREDIT entry and the events, all in one transaction", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("deposits", wallet.id, "50.00", "cashier-1");

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      transactionId: expect.any(String),
      status: "PROCESSED",
      balance: { amount: "150.00", currency: "BRL" },
      failureCode: null,
      idempotentReplay: false,
    });
    expect(await transactionRow(response.body.transactionId)).toEqual({
      kind: "DEPOSIT",
      status: "PROCESSED",
      provider_id: "internal",
      idempotency_key: `internal:${wallet.id}:cashier-1`,
      failure_code: null as unknown as string,
      amount: "50.00",
      observed: "150.00",
    });
    expect((await ledgerOf(wallet.id)).at(-1)).toEqual({ direction: "CREDIT", amount: "50.00", before: "100.00", after: "150.00" });
    expect(await eventsOf(response.body.transactionId)).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);

    const view = await http(app.url, "GET", `/wallets/${wallet.id}`);
    expect(view.body).toMatchObject({ balance: { amount: "150.00" }, version: 2 });
    const reconciliation = await http(app.url, "POST", `/wallets/${wallet.id}/reconciliation`);
    expect(reconciliation.body).toMatchObject({ consistent: true, checkedEntries: 2 });
    await expectLedgerMatchesBalances(db);
  });

  it("works on an empty wallet (no OPENING)", async () => {
    const wallet = await createWallet(app.url, "0.00");

    const response = await move("deposits", wallet.id, "10.00");

    expect(response.status).toBe(201);
    expect(await balanceOf(app.url, wallet.id)).toBe("10.00");
    await expectLedgerMatchesBalances(db);
  });

  it("is visible through the transaction query routes", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const { body } = await move("deposits", wallet.id, "50.00", "cashier-7");

    const byId = await http(app.url, "GET", `/wagering/transactions/${body.transactionId}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({ kind: "DEPOSIT", providerId: "internal", status: "PROCESSED", walletId: wallet.id });

    const byExternalId = await http(
      app.url,
      "GET",
      `/providers/internal/wagering/transactions/${encodeURIComponent(`deposit:${wallet.id}:cashier-7`)}`,
    );
    expect(byExternalId.body.transactionId).toBe(body.transactionId);
  });
});

describe("POST /wallets/:walletId/withdrawals", () => {
  it("takes the amount, records a DEBIT entry and the events", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("withdrawals", wallet.id, "30.00");

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "PROCESSED", balance: { amount: "70.00", currency: "BRL" } });
    expect((await transactionRow(response.body.transactionId))?.kind).toBe("WITHDRAWAL");
    expect((await ledgerOf(wallet.id)).at(-1)).toEqual({ direction: "DEBIT", amount: "30.00", before: "100.00", after: "70.00" });
    expect(await eventsOf(response.body.transactionId)).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
    await expectLedgerMatchesBalances(db);
  });

  it("can take the whole balance, down to exactly zero", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("withdrawals", wallet.id, "100.00");

    expect(response.status).toBe(201);
    expect(response.body.balance.amount).toBe("0.00");
    await expectLedgerMatchesBalances(db);
  });

  it("rejects a withdrawal larger than the balance (422), keeps it for auditing and never goes negative", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("withdrawals", wallet.id, "100.01", "cashier-9");

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      status: "REJECTED",
      failureCode: "INSUFFICIENT_FUNDS",
      balance: { amount: "100.00", currency: "BRL" },
      idempotentReplay: false,
    });
    expect(await transactionRow(response.body.transactionId)).toMatchObject({ kind: "WITHDRAWAL", status: "REJECTED", failure_code: "INSUFFICIENT_FUNDS" });
    expect(await ledgerOf(wallet.id)).toHaveLength(1); // only the OPENING
    expect(await eventsOf(response.body.transactionId)).toEqual(["WagerTransactionRejected"]);
    expect(await balanceOf(app.url, wallet.id)).toBe("100.00");

    const again = await move("withdrawals", wallet.id, "100.01", "cashier-9");
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({ transactionId: response.body.transactionId, idempotentReplay: true });
    await expectLedgerMatchesBalances(db);
  });
});

describe("deposits and withdrawals: shared rules", () => {
  it.each(["deposits", "withdrawals"] as const)("%s: the same request again is a replay (200) and moves money once", async (operation) => {
    const wallet = await createWallet(app.url, "100.00");

    const first = await move(operation, wallet.id, "40.00", "same-key");
    await move(operation === "deposits" ? "withdrawals" : "deposits", wallet.id, "1.00"); // the balance moves in between
    const replay = await move(operation, wallet.id, "40.00", "same-key");

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true }); // balance of that moment, not the current one
    expect(await ledgerOf(wallet.id)).toHaveLength(3); // OPENING + this one + the other
    await expectLedgerMatchesBalances(db);
  });

  it("the same key with another amount, or reused for the other operation, is 409 and stores nothing", async () => {
    const wallet = await createWallet(app.url, "100.00");
    await move("deposits", wallet.id, "40.00", "key-1");

    const otherAmount = await move("deposits", wallet.id, "41.00", "key-1");
    const otherOperation = await move("withdrawals", wallet.id, "40.00", "key-1");

    expect(otherAmount.status).toBe(409);
    expect(otherAmount.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(otherOperation.status).toBe(409);
    expect(await balanceOf(app.url, wallet.id)).toBe("140.00");
    expect(await db.sql(`select 1 from "wager_transactions" where "kind" in ('DEPOSIT', 'WITHDRAWAL')`)).toHaveLength(1);
  });

  it("scopes the Idempotency-Key to the wallet: the same key on two wallets is two operations", async () => {
    const a = await createWallet(app.url, "100.00");
    const b = await createWallet(app.url, "100.00");

    const onA = await move("deposits", a.id, "10.00", "shared-key");
    const onB = await move("deposits", b.id, "10.00", "shared-key");

    expect([onA.status, onB.status]).toEqual([201, 201]);
    expect(onA.body.transactionId).not.toBe(onB.body.transactionId);
    await expectLedgerMatchesBalances(db);
  });

  it("rejects another currency (422 CURRENCY_MISMATCH) without moving money", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("deposits", wallet.id, "10.00", unique("key"), "USD");

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: "REJECTED", failureCode: "CURRENCY_MISMATCH" });
    expect(await balanceOf(app.url, wallet.id)).toBe("100.00");
    await expectLedgerMatchesBalances(db);
  });

  it.each([
    ["no Idempotency-Key", "10.00", null, "INVALID_PAYLOAD"],
    ["integer amount", "10", "k", "INVALID_PAYLOAD"],
    ["one decimal place", "10.5", "k", "INVALID_PAYLOAD"],
    ["three decimal places", "10.001", "k", "INVALID_PAYLOAD"],
    ["negative amount", "-10.00", "k", "INVALID_PAYLOAD"],
    ["zero", "0.00", "k", "INVALID_AMOUNT"],
  ] as const)("400 for %s, before touching the database", async (_name, amount, key, code) => {
    const wallet = await createWallet(app.url, "100.00");

    const response = await move("withdrawals", wallet.id, amount, key);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(code);
    expect(await db.sql(`select 1 from "wager_transactions" where "kind" = 'WITHDRAWAL'`)).toHaveLength(0);
  });

  it("400 for a body without money and for a malformed wallet id; 404 for an unknown wallet", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const noMoney = await http(app.url, "POST", `/wallets/${wallet.id}/deposits`, {}, { "Idempotency-Key": "k" });
    const badId = await move("deposits", "abc", "10.00");
    const unknown = await move("deposits", "AAAAAAAAAAAAAAAA", "10.00");

    expect(noMoney.status).toBe(400);
    expect(badId.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("WALLET_NOT_FOUND");
  });

  it("a provider cannot create a DEPOSIT or a WITHDRAWAL through /wagering/transactions", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const deposit = await submit(app.url, wallet, { kind: "DEPOSIT", amount: "1000.00" });
    const withdrawal = await submit(app.url, wallet, { kind: "WITHDRAWAL", amount: "10.00" });

    expect(deposit.status).toBe(400);
    expect(withdrawal.status).toBe(400);
    expect(await balanceOf(app.url, wallet.id)).toBe("100.00");
  });

  it("parallel withdrawals never overdraw: 10 × 30.00 on 100.00 → exactly 3 pass", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const responses = await Promise.all(Array.from({ length: 10 }, () => move("withdrawals", wallet.id, "30.00")));

    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 422 && r.body.failureCode === "INSUFFICIENT_FUNDS")).toHaveLength(7);
    expect(await balanceOf(app.url, wallet.id)).toBe("10.00");
    await expectLedgerMatchesBalances(db);
  });

  it("the same deposit sent 10 times in parallel credits once", async () => {
    const wallet = await createWallet(app.url, "100.00");

    const responses = await Promise.all(Array.from({ length: 10 }, () => move("deposits", wallet.id, "25.00", "burst")));

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.transactionId)).size).toBe(1);
    expect(await balanceOf(app.url, wallet.id)).toBe("125.00");
    await expectLedgerMatchesBalances(db);
  });
});
