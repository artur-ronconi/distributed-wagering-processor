import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { IdValueObject } from "ddd-tool-kit";

import { ConcurrencyConflictError } from "../../../src/shared/errors/concurrency-conflict.error";
import { DuplicateKeyError } from "../../../src/shared/errors/duplicate-key.error";
import { TransientInfrastructureError } from "../../../src/shared/errors/transient-infrastructure.error";
import { WalletAggregate } from "../../../src/modules/wallet/domain/aggregate/aggregate-root/wallet.aggregate-root";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { FailureCode } from "../../../src/shared/domain/failure-code";
import { InboxMessageAggregate } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root";
import { OutboxMessageAggregate } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root";
import { connectTestDatabase, expectLedgerMatchesBalances, type TestDatabase } from "../../support/database";
import { now, openWallet, unique, wagerTransaction } from "../../support/factories";
import { brl } from "../../support/money";

let db: TestDatabase;

beforeAll(async () => {
  db = await connectTestDatabase({ lockTimeoutMs: 1_000 });
});
afterAll(async () => db.close());
beforeEach(async () => db.truncate());

const persistOpenedWallet = async (initialBalance = "100.00", playerId?: string) => {
  const { wallet, opening } = openWallet(initialBalance, playerId);
  await db.uow.transactional(async () => {
    await db.wallets.insert(wallet);
    await db.transactions.insert(opening);
  });
  return { wallet, opening };
};

describe("persistence (real PostgreSQL)", () => {
  describe("migrations", () => {
    it("can be reverted and applied again", async () => {
      const migrator = db.orm.getMigrator();
      await migrator.down();
      expect(await db.sql(`select to_regclass('public.wallets') as t`)).toEqual([{ t: null }]);
      await migrator.up();
      expect((await db.sql<{ t: string }>(`select to_regclass('public.wallets')::text as t`))[0]?.t).toBe("wallets");
    });
  });

  describe("wallets and ledger", () => {
    it("inserts the wallet with its OPENING entry and reads it back", async () => {
      const { wallet } = await persistOpenedWallet("1000.00");

      const loaded = await db.uow.transactional(() => db.wallets.findById(wallet.id));

      expect(loaded?.balance.toString()).toBe("1000.00");
      expect(loaded?.version).toBe(1);
      expect(loaded?.newLedgerEntries).toHaveLength(0);
      const entries = await db.sql<{ direction: string; amount: string }>(
        `select "direction", "amount"::text from "wallet_ledger_entries" where "wallet_id" = ?`,
        [wallet.id.value],
      );
      expect(entries).toEqual([{ direction: "CREDIT", amount: "1000.00" }]);
      await expectLedgerMatchesBalances(db);
    });

    it("saves a debit with its ledger entry and bumps the version", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const bet = wagerTransaction(wallet);

      await db.uow.transactional(async () => {
        const locked = (await db.wallets.findByIdForUpdate(wallet.id)) as WalletAggregate;
        const expectedVersion = locked.version;
        locked.debit(bet.money, bet.id);
        bet.markProcessed(undefined, now(), locked.balance);
        await db.transactions.insert(bet);
        await db.wallets.save(locked, expectedVersion);
      });

      const loaded = await db.uow.transactional(() => db.wallets.findById(wallet.id));
      expect(loaded?.balance.toString()).toBe("75.00");
      expect(loaded?.version).toBe(2);
      await expectLedgerMatchesBalances(db);
    });

    it("refuses a save with a stale version (optimistic safety net)", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const stale = (await db.uow.transactional(() => db.wallets.findById(wallet.id))) as WalletAggregate;
      stale.debit(brl("1.00"), IdValueObject.getDefault());

      await expect(db.uow.transactional(() => db.wallets.save(stale, 99))).rejects.toBeInstanceOf(
        ConcurrencyConflictError,
      );
    });

    it("rolls back wallet, ledger, transaction and outbox together", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const bet = wagerTransaction(wallet);

      await expect(
        db.uow.transactional(async () => {
          const locked = (await db.wallets.findByIdForUpdate(wallet.id)) as WalletAggregate;
          locked.debit(bet.money, bet.id);
          await db.transactions.insert(bet);
          await db.wallets.save(locked, 1);
          await db.outbox.insert(
            OutboxMessageAggregate.enqueue({
              eventId: IdValueObject.getDefault().value,
              eventType: "WalletBalanceChanged",
              aggregateId: wallet.id.value,
              occurredAt: new Date(),
              toJSON: () => ({}),
            }).result as OutboxMessageAggregate,
          );
          throw new Error("process died before commit");
        }),
      ).rejects.toThrow("process died before commit");

      const [counts] = await db.sql<{ tx: number; ledger: number; outbox: number }>(
        `select (select count(*)::int from "wager_transactions" where "kind" = 'BET') as tx,
                (select count(*)::int from "wallet_ledger_entries") as ledger,
                (select count(*)::int from "outbox_messages") as outbox`,
      );
      expect(counts).toEqual({ tx: 0, ledger: 1, outbox: 0 });
      const loaded = await db.uow.transactional(() => db.wallets.findById(wallet.id));
      expect(loaded?.balance.toString()).toBe("100.00");
    });
  });

  describe("database constraints", () => {
    it("one wallet per player and currency", async () => {
      const playerId = unique("player");
      await persistOpenedWallet("10.00", playerId);

      const error = await persistOpenedWallet("10.00", playerId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DuplicateKeyError);
      expect((error as DuplicateKeyError).constraint).toBe("wallets_player_currency_unique");
    });

    it("balance can never be negative", async () => {
      const { wallet } = await persistOpenedWallet("10.00");
      await expect(
        db.sql(`update "wallets" set "balance_amount" = -1 where "id" = ?`, [wallet.id.value]),
      ).rejects.toThrow();
    });

    it("the ledger is append-only (UPDATE and DELETE are refused)", async () => {
      await persistOpenedWallet("10.00");
      await expect(db.sql(`update "wallet_ledger_entries" set "amount" = 1`)).rejects.toThrow(/append-only/);
      await expect(db.sql(`delete from "wallet_ledger_entries"`)).rejects.toThrow(/append-only/);
    });

    it("an unbalanced ledger entry is refused", async () => {
      const { wallet, opening } = await persistOpenedWallet("10.00");
      await expect(
        db.sql(
          `insert into "wallet_ledger_entries" values (?, ?, ?, 'CREDIT', 5, 10, 16, 'BRL', now())`,
          [IdValueObject.getDefault().value, wallet.id.value, opening.id.value],
        ),
      ).rejects.toThrow(/ledger_entry_is_balanced|ledger_one_entry_per_transaction/);
    });

    it("an idempotency key is unique", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const first = wagerTransaction(wallet, { externalTransactionId: "tx-1", idempotencyKey: "same-key" });
      const second = wagerTransaction(wallet, { externalTransactionId: "tx-2", idempotencyKey: "same-key" });
      await db.uow.transactional(() => db.transactions.insert(first));

      const error = await db.uow.transactional(() => db.transactions.insert(second)).catch((e: unknown) => e);
      expect((error as DuplicateKeyError).constraint).toBe("wager_tx_idempotency_key_unique");
    });

    it("a reference cannot be reverted twice (REFUND and ROLLBACK share the slot)", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const bet = wagerTransaction(wallet);
      bet.markProcessed(undefined, now(), brl("75.00"));
      await db.uow.transactional(() => db.transactions.insert(bet));

      const refund = () => {
        const tx = wagerTransaction(wallet, {
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: bet.externalTransactionId,
        });
        tx.markProcessed(bet.id, now(), brl("100.00"));
        return tx;
      };
      expect(await db.uow.transactional(() => db.transactions.isAlreadyReversed(bet.id))).toBe(false);
      await db.uow.transactional(() => db.transactions.insert(refund()));

      const rollback = wagerTransaction(wallet, {
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: bet.externalTransactionId,
      });
      rollback.markProcessed(bet.id, now(), brl("75.00"));
      for (const second of [refund(), rollback]) {
        const error = await db.uow.transactional(() => db.transactions.insert(second)).catch((e: unknown) => e);
        expect((error as DuplicateKeyError).constraint).toBe("wager_tx_single_reversal");
      }
      expect(await db.uow.transactional(() => db.transactions.isAlreadyReversed(bet.id))).toBe(true);
    });

    it("a ledger entry must point to an existing transaction (checked at commit)", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const orphan = WalletAggregate.rehydrate({
        id: wallet.id,
        playerId: wallet.playerId,
        currency: "BRL",
        balance: brl("100.00"),
        version: 1,
      });
      orphan.credit(brl("1.00"), IdValueObject.getDefault());

      await expect(db.uow.transactional(() => db.wallets.save(orphan, 1))).rejects.toThrow();
    });
  });

  describe("wager transactions", () => {
    it("round-trips every field and saves status changes", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      const rollback = wagerTransaction(wallet, {
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "bet-404",
      });
      rollback.markPendingReference(now());
      await db.uow.transactional(() => db.transactions.insert(rollback));

      const loaded = await db.uow.transactional(() =>
        db.transactions.findByExternalId("provider-a", rollback.externalTransactionId),
      );
      expect(loaded?.status).toBe(WagerTransactionStatus.PendingReference);
      expect(loaded?.referenceExternalTransactionId).toBe("bet-404");
      expect(loaded?.money.toString()).toBe("25.00");

      loaded?.reject(FailureCode.ReferenceNotFound, now());
      await db.uow.transactional(() => db.transactions.save(loaded!));

      const rejected = await db.uow.transactional(() => db.transactions.findById(rollback.id));
      expect(rejected?.status).toBe(WagerTransactionStatus.Rejected);
      expect(rejected?.failureCode).toBe(FailureCode.ReferenceNotFound);
      expect(rejected?.nextReferenceAttemptAt).toBeUndefined();
    });
  });

  describe("locking", () => {
    it("a second lock on the same wallet waits, then times out as a transient failure", async () => {
      const { wallet } = await persistOpenedWallet("100.00");
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));

      const holder = db.uow.transactional(async () => {
        await db.wallets.findByIdForUpdate(wallet.id);
        await held;
      });
      await Bun.sleep(100);

      const startedAt = Date.now();
      const error = await db.uow
        .transactional(() => db.wallets.findByIdForUpdate(wallet.id))
        .catch((e: unknown) => e);
      release();
      await holder;

      expect(error).toBeInstanceOf(TransientInfrastructureError);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    });

    it("locks are per wallet: another wallet is not blocked", async () => {
      const a = await persistOpenedWallet("100.00");
      const b = await persistOpenedWallet("100.00");
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));

      const holder = db.uow.transactional(async () => {
        await db.wallets.findByIdForUpdate(a.wallet.id);
        await held;
      });
      await Bun.sleep(100);

      const other = await db.uow.transactional(() => db.wallets.findByIdForUpdate(b.wallet.id));
      release();
      await holder;
      expect(other?.id.equals(b.wallet.id)).toBe(true);
    });
  });

  describe("inbox and outbox", () => {
    it("the inbox registers a message only once per consumer", async () => {
      const message = () =>
        InboxMessageAggregate.receive({ messageId: "msg-1", consumerName: "consumer-a", payloadHash: "h".repeat(64) })
          .result as InboxMessageAggregate;
      const other = InboxMessageAggregate.receive({
        messageId: "msg-1",
        consumerName: "consumer-b",
        payloadHash: "h".repeat(64),
      }).result as InboxMessageAggregate;

      expect(await db.uow.transactional(() => db.inbox.tryRegister(message()))).toBe(true);
      expect(await db.uow.transactional(() => db.inbox.tryRegister(message()))).toBe(false);
      expect(await db.uow.transactional(() => db.inbox.tryRegister(other))).toBe(true);
    });

    it("concurrent publishers lock disjoint outbox batches (SKIP LOCKED)", async () => {
      await db.uow.transactional(async () => {
        for (let i = 0; i < 6; i += 1) {
          await db.outbox.insert(
            OutboxMessageAggregate.enqueue({
              eventId: IdValueObject.getDefault().value,
              eventType: "WalletBalanceChanged",
              aggregateId: IdValueObject.getDefault().value,
              occurredAt: new Date(Date.now() - 1_000 + i),
              toJSON: () => ({ i }),
            }).result as OutboxMessageAggregate,
          );
        }
      });

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let firstIds: string[] = [];
      const first = db.uow.transactional(async () => {
        firstIds = (await db.outbox.lockDueBatch(new Date(), 4)).map((m) => m.id.value);
        await held;
      });
      await Bun.sleep(100);

      const secondIds = await db.uow.transactional(async () =>
        (await db.outbox.lockDueBatch(new Date(), 4)).map((m) => m.id.value),
      );
      release();
      await first;

      expect(firstIds).toHaveLength(4);
      expect(secondIds).toHaveLength(2);
      expect(firstIds.filter((id) => secondIds.includes(id))).toHaveLength(0);
    });
  });
});
