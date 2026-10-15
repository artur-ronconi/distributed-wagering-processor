import { SQL } from "bun";

import { config } from "./config";

/** Read-only inspection of the backend database. The visualizer never writes here. */
const sql = new SQL(config.databaseUrl);

interface InspectQuery {
  walletId?: string;
  playerId?: string;
  currency?: string;
  idempotencyKey?: string;
  transactionId?: string;
  providerId?: string;
  externalTransactionId?: string;
  referenceExternalTransactionId?: string;
  openingOfWallet?: string;
  messageId?: string;
}

type Row = Record<string, unknown>;

const trim = (value: unknown) => (typeof value === "string" ? value.trim() : value);

const camel = (row: Row | undefined | null): Row | null => {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), trim(value)]),
  );
};

const first = async (rows: Promise<Row[]>) => camel((await rows)[0]);

const walletColumns = sql`id, player_id, currency, balance_amount, version, created_at, updated_at`;

const findWallet = (q: InspectQuery) => {
  if (q.walletId) return first(sql`select ${walletColumns} from wallets where id = ${q.walletId}`);
  if (q.playerId && q.currency) {
    return first(sql`select ${walletColumns} from wallets where player_id = ${q.playerId} and currency = ${q.currency}`);
  }
  return Promise.resolve(null);
};

const findTransaction = (q: InspectQuery) => {
  if (q.idempotencyKey) return first(sql`select * from wager_transactions where idempotency_key = ${q.idempotencyKey}`);
  if (q.transactionId) return first(sql`select * from wager_transactions where id = ${q.transactionId}`);
  if (q.providerId && q.externalTransactionId) {
    return first(
      sql`select * from wager_transactions
          where provider_id = ${q.providerId} and external_transaction_id = ${q.externalTransactionId}`,
    );
  }
  if (q.openingOfWallet) {
    return first(sql`select * from wager_transactions where wallet_id = ${q.openingOfWallet} and kind = 'OPENING'`);
  }
  return Promise.resolve(null);
};

const ledgerTotals = async (walletId: string) =>
  first(sql`
    select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::numeric(19,2)::text as calculated,
           count(*)::int as entries
    from wallet_ledger_entries where wallet_id = ${walletId}`);

const outboxColumns = sql`id, aggregate_id, event_type, attempts, next_attempt_at, published_at, occurred_at, created_at, payload`;

const outboxForTransaction = async (transactionId: string) =>
  (
    await sql`select ${outboxColumns} from outbox_messages
              where payload->'data'->>'transactionId' = ${transactionId}
              order by occurred_at, id`
  ).map(camel);

const outboxByIds = async (ids: string[]) =>
  ids.length === 0 ? [] : (await sql`select ${outboxColumns} from outbox_messages where id in ${sql(ids)}`).map(camel);

/** One call gathers every row a flow may touch, so the UI can diff "before" and "after". */
const inspect = async (q: InspectQuery) => {
  const [wallet, transaction] = await Promise.all([findWallet(q), findTransaction(q)]);

  const providerId = (transaction?.providerId as string | undefined) ?? q.providerId;
  const referenceExternalId =
    (transaction?.referenceExternalTransactionId as string | undefined) ?? q.referenceExternalTransactionId;

  const [reference, externalIdOwner, totals, ledger, outbox, inbox, pendingOutbox] = await Promise.all([
    providerId && referenceExternalId
      ? first(
          sql`select * from wager_transactions
              where provider_id = ${providerId} and external_transaction_id = ${referenceExternalId}`,
        )
      : null,
    q.providerId && q.externalTransactionId
      ? first(
          sql`select id, idempotency_key, status from wager_transactions
              where provider_id = ${q.providerId} and external_transaction_id = ${q.externalTransactionId}`,
        )
      : null,
    wallet ? ledgerTotals(wallet.id as string) : null,
    transaction
      ? (await sql`select * from wallet_ledger_entries where transaction_id = ${transaction.id as string}`).map(camel)
      : [],
    transaction ? outboxForTransaction(transaction.id as string) : [],
    q.messageId ? first(sql`select * from inbox_messages where message_id = ${q.messageId}`) : null,
    first(sql`select count(*)::int as pending from outbox_messages where published_at is null`),
  ]);

  return {
    at: new Date().toISOString(),
    wallet,
    ledgerTotals: totals,
    transaction,
    reference,
    externalIdOwner,
    ledger,
    outbox,
    inbox,
    outboxPending: pendingOutbox?.pending ?? 0,
  };
};

const ping = async () => {
  await sql`select 1`;
  return true;
};

export { inspect, outboxByIds, ping, type InspectQuery };
