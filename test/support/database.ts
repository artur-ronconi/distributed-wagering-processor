import { MikroORM } from "@mikro-orm/postgresql";

import { createMikroOrmConfig } from "../../src/config/mikro-orm.config";
import { MikroOrmUnitOfWork } from "../../src/shared/infrastructure/database/mikro-orm.unit-of-work";
import { MikroOrmWalletRepository } from "../../src/modules/wallet/infrastructure/database/repositories/mikro-orm.wallet.repository";
import { MikroOrmWagerTransactionRepository } from "../../src/modules/wager-transaction/infrastructure/database/repositories/mikro-orm.wager-transaction.repository";
import { MikroOrmInboxMessageRepository } from "../../src/modules/messaging/infrastructure/database/repositories/mikro-orm.inbox-message.repository";
import { MikroOrmOutboxMessageRepository } from "../../src/modules/messaging/infrastructure/database/repositories/mikro-orm.outbox-message.repository";
import { MikroOrmWalletLedgerQuery } from "../../src/modules/wallet/infrastructure/database/queries/mikro-orm.wallet-ledger.query";
import { MikroOrmLedgerReconciliationQuery } from "../../src/modules/wallet/infrastructure/database/queries/mikro-orm.ledger-reconciliation.query";

/** Real PostgreSQL from docker compose (host port 5433), separate database for tests. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://wagering:wagering@localhost:5433/wagering_test";

export interface TestDatabase {
  orm: MikroORM;
  uow: MikroOrmUnitOfWork;
  wallets: MikroOrmWalletRepository;
  transactions: MikroOrmWagerTransactionRepository;
  inbox: MikroOrmInboxMessageRepository;
  outbox: MikroOrmOutboxMessageRepository;
  ledgerQuery: MikroOrmWalletLedgerQuery;
  reconciliationQuery: MikroOrmLedgerReconciliationQuery;
  /** Raw SQL outside any transaction, for assertions and fixtures. */
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export const connectTestDatabase = async (options: { lockTimeoutMs?: number; poolMax?: number } = {}) => {
  const orm = await MikroORM.init(
    createMikroOrmConfig({ databaseUrl: TEST_DATABASE_URL, databasePoolMax: options.poolMax ?? 30 }),
  );
  await orm.getMigrator().up();

  const em = orm.em;
  const sql = async <T>(query: string, params: unknown[] = []): Promise<T[]> =>
    (await em.getConnection().execute(query, params)) as T[];

  const db: TestDatabase = {
    orm,
    uow: new MikroOrmUnitOfWork(em, { lockTimeoutMs: options.lockTimeoutMs ?? 5_000 }),
    wallets: new MikroOrmWalletRepository(em),
    transactions: new MikroOrmWagerTransactionRepository(em),
    inbox: new MikroOrmInboxMessageRepository(em),
    outbox: new MikroOrmOutboxMessageRepository(em),
    ledgerQuery: new MikroOrmWalletLedgerQuery(em),
    reconciliationQuery: new MikroOrmLedgerReconciliationQuery(em),
    sql,
    // TRUNCATE does not fire the append-only row trigger, so tests can reset the ledger.
    truncate: async () => {
      await sql(
        `truncate table "wallet_ledger_entries", "wager_transactions", "wallets", "inbox_messages", "outbox_messages" cascade`,
      );
    },
    close: () => orm.close(true),
  };
  return db;
};

/** wallet.balance == balance rebuilt from the ledger, for every wallet (OLD_README §13). */
export const expectLedgerMatchesBalances = async (db: TestDatabase): Promise<void> => {
  const rows = await db.sql<{ id: string; stored: string; calculated: string }>(
    `select w."id", w."balance_amount"::text as stored,
            coalesce(sum(case when l."direction" = 'CREDIT' then l."amount" else -l."amount" end), 0)::numeric(19,2)::text
              as calculated
     from "wallets" w left join "wallet_ledger_entries" l on l."wallet_id" = w."id"
     group by w."id", w."balance_amount"`,
  );
  const divergent = rows.filter((row) => row.stored !== row.calculated);
  if (divergent.length > 0) throw new Error(`ledger diverges from balance: ${JSON.stringify(divergent)}`);
};
