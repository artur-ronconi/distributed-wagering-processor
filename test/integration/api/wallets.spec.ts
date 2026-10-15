import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../../support/database";
import { http, startTestApp, type TestApp } from "../../support/app";
import { createWallet, submit } from "../../support/api";
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

describe("POST /wallets", () => {
  it("creates the wallet with version 1, an OPENING transaction, its CREDIT entry and events", async () => {
    const playerId = unique("player");
    const response = await http(app.url, "POST", "/wallets", {
      playerId,
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      playerId,
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });
    expect(response.headers.get("x-correlation-id")).toBeTruthy();

    const [opening] = await db.sql<{ kind: string; status: string }>(
      `select "kind", "status" from "wager_transactions" where "wallet_id" = ?`,
      [response.body.id],
    );
    expect(opening).toEqual({ kind: "OPENING", status: "PROCESSED" });
    const events = await db.sql<{ event_type: string }>(`select "event_type" from "outbox_messages" order by "event_type"`);
    expect(events.map((e) => e.event_type)).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
    await expectLedgerMatchesBalances(db);
  });

  it("creates an empty wallet without OPENING nor ledger entry", async () => {
    const response = await http(app.url, "POST", "/wallets", {
      playerId: unique("player"),
      initialBalance: { amount: "0.00", currency: "BRL" },
    });

    expect(response.status).toBe(201);
    expect(await db.sql(`select 1 from "wager_transactions"`)).toHaveLength(0);
    expect(await db.sql(`select 1 from "wallet_ledger_entries"`)).toHaveLength(0);
  });

  it("refuses a second wallet for the same player and currency (409), also when simultaneous", async () => {
    const playerId = unique("player");
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        http(app.url, "POST", "/wallets", { playerId, initialBalance: { amount: "10.00", currency: "BRL" } }),
      ),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(responses.find((r) => r.status === 409)?.body.code).toBe("WALLET_ALREADY_EXISTS");
    expect(await db.sql(`select 1 from "wallets"`)).toHaveLength(1);
  });

  it("allows the same player in another currency", async () => {
    const playerId = unique("player");
    await createWallet(app.url, "10.00", playerId);
    const usd = await http(app.url, "POST", "/wallets", { playerId, initialBalance: { amount: "10.00", currency: "USD" } });
    expect(usd.status).toBe(201);
  });

  it.each([
    ["integer amount", { playerId: "p", initialBalance: { amount: "1000", currency: "BRL" } }],
    ["negative amount", { playerId: "p", initialBalance: { amount: "-1.00", currency: "BRL" } }],
    ["3 decimals", { playerId: "p", initialBalance: { amount: "10.005", currency: "BRL" } }],
    ["number instead of string", { playerId: "p", initialBalance: { amount: 10, currency: "BRL" } }],
    ["lowercase currency", { playerId: "p", initialBalance: { amount: "10.00", currency: "brl" } }],
    ["missing balance", { playerId: "p" }],
    ["empty player", { playerId: "", initialBalance: { amount: "10.00", currency: "BRL" } }],
  ])("400 INVALID_PAYLOAD for %s", async (_name, body) => {
    const response = await http(app.url, "POST", "/wallets", body);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_PAYLOAD");
    expect(response.body.correlationId).toBeTruthy();
  });

  it("400 for malformed JSON", async () => {
    const response = await fetch(`${app.url}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_PAYLOAD");
  });
});

describe("GET /wallets/:walletId", () => {
  it("returns the materialized balance and version", async () => {
    const wallet = await createWallet(app.url, "100.00");
    await submit(app.url, wallet, { amount: "25.00" });

    const response = await http(app.url, "GET", `/wallets/${wallet.id}`);
    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(response.body.version).toBe(2);
  });

  it("404 for an unknown wallet and 400 for a malformed id", async () => {
    expect((await http(app.url, "GET", "/wallets/aaaaaaaaaaaaaaaa")).body.code).toBe("WALLET_NOT_FOUND");
    expect((await http(app.url, "GET", "/wallets/nope")).status).toBe(400);
  });

  it("echoes a valid X-Correlation-Id", async () => {
    const response = await http(app.url, "GET", "/wallets/nope", undefined, { "X-Correlation-Id": "corr-123" });
    expect(response.headers.get("x-correlation-id")).toBe("corr-123");
    expect(response.body.correlationId).toBe("corr-123");
  });
});

describe("GET /wallets/:walletId/ledger", () => {
  it("paginates newest first with a stable cursor, even when entries are appended", async () => {
    const wallet = await createWallet(app.url, "1000.00");
    for (let i = 0; i < 24; i += 1) await submit(app.url, wallet, { amount: "1.00" });

    const page1 = await http(app.url, "GET", `/wallets/${wallet.id}/ledger?limit=10`);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.nextCursor).toBeTruthy();

    // a new entry between pages must not shift the next pages
    await submit(app.url, wallet, { amount: "1.00" });

    const page2 = await http(app.url, "GET", `/wallets/${wallet.id}/ledger?limit=10&cursor=${page1.body.nextCursor}`);
    const page3 = await http(app.url, "GET", `/wallets/${wallet.id}/ledger?limit=10&cursor=${page2.body.nextCursor}`);

    expect(page2.body.items).toHaveLength(10);
    expect(page3.body.items).toHaveLength(5); // 24 debits + OPENING = 25 entries before the append
    expect(page3.body.nextCursor).toBeNull();
    expect(page3.body.items.at(-1).direction).toBe("CREDIT");

    const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(25);

    const again = await http(app.url, "GET", `/wallets/${wallet.id}/ledger?limit=10&cursor=${page1.body.nextCursor}`);
    expect(again.body).toEqual(page2.body);
  });

  it("returns an empty page for a wallet without entries", async () => {
    const wallet = await createWallet(app.url, "0.00");
    const response = await http(app.url, "GET", `/wallets/${wallet.id}/ledger`);
    expect(response.body).toEqual({ items: [], nextCursor: null });
  });

  it.each(["limit=0", "limit=201", "limit=abc", "cursor=garbage"])("400 for %s", async (query) => {
    const wallet = await createWallet(app.url, "10.00");
    const response = await http(app.url, "GET", `/wallets/${wallet.id}/ledger?${query}`);
    expect(response.status).toBe(400);
  });
});

describe("POST /wallets/:walletId/reconciliation", () => {
  it("is consistent after a mix of operations", async () => {
    const wallet = await createWallet(app.url, "100.00");
    const bet = await submit(app.url, wallet, { amount: "30.00" });
    await submit(app.url, wallet, { kind: "WIN", amount: "45.50" });
    await submit(app.url, wallet, { kind: "LOSS", amount: "0.00" });
    await submit(app.url, wallet, {
      kind: "ROLLBACK",
      amount: "30.00",
      reference: bet.request.externalTransactionId,
    });

    const response = await http(app.url, "POST", `/wallets/${wallet.id}/reconciliation`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: "145.50", currency: "BRL" },
      calculatedBalance: { amount: "145.50", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 4,
    });
  });

  it("reports a divergence without fixing it, and counts it in the metrics", async () => {
    const wallet = await createWallet(app.url, "100.00");
    await db.sql(`update "wallets" set "balance_amount" = 75 where "id" = ?`, [wallet.id]);

    const response = await http(app.url, "POST", `/wallets/${wallet.id}/reconciliation`);
    expect(response.status).toBe(200);
    expect(response.body.consistent).toBe(false);
    expect(response.body.difference).toEqual({ amount: "-25.00", currency: "BRL" });
    expect((await http(app.url, "GET", `/wallets/${wallet.id}`)).body.balance.amount).toBe("75.00");

    const metrics = (await http(app.url, "GET", "/metrics")).body as string;
    expect(metrics).toMatch(/wagering_reconciliation_mismatches_total\{currency="BRL"\} [1-9]/);
  });

  it("404 for an unknown wallet", async () => {
    expect((await http(app.url, "POST", "/wallets/aaaaaaaaaaaaaaaa/reconciliation")).status).toBe(404);
  });
});
