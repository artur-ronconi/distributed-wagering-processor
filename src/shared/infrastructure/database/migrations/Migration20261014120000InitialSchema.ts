import { Migration } from "@mikro-orm/migrations";

/**
 * Canonical database schema. Uniqueness, immutability and non-negativity are enforced here,
 * not only in application code (OLD_README §5.9).
 */
export class Migration20261014120000InitialSchema extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id"             char(16)      primary key,
        "player_id"      text          not null check (length("player_id") between 1 and 128),
        "currency"       char(3)       not null check ("currency" ~ '^[A-Z]{3}$'),
        "balance_amount" numeric(19,2) not null check ("balance_amount" >= 0),
        "version"        integer       not null check ("version" >= 1),
        "created_at"     timestamptz   not null,
        "updated_at"     timestamptz   not null,
        constraint "wallets_player_currency_unique" unique ("player_id", "currency")
      );
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id"                                char(16)      primary key,
        "provider_id"                       text          not null,
        "external_transaction_id"           text          not null,
        "idempotency_key"                   text          not null,
        "payload_hash"                      char(64)      not null,
        "wallet_id"                         char(16)      not null references "wallets" ("id"),
        "player_id"                         text          not null,
        "round_id"                          text          not null,
        "game_id"                           text          not null,
        "kind"                              text          not null
          check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        "amount"                            numeric(19,2) not null check ("amount" >= 0),
        "currency"                          char(3)       not null,
        "reference_external_transaction_id" text,
        "status"                            text          not null
          check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        "reference_transaction_id"          char(16)      references "wager_transactions" ("id"),
        "failure_code"                      text,
        "observed_balance_amount"           numeric(19,2) check ("observed_balance_amount" >= 0),
        "processed_at"                      timestamptz,
        "reference_attempts"                integer       not null default 0 check ("reference_attempts" >= 0),
        "next_reference_attempt_at"         timestamptz,
        "created_at"                        timestamptz   not null,
        "updated_at"                        timestamptz   not null,
        constraint "wager_tx_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_tx_provider_external_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_tx_reference_required"
          check ("kind" not in ('REFUND', 'ROLLBACK') or "reference_external_transaction_id" is not null),
        constraint "wager_tx_rejected_has_failure_code"
          check ("status" not in ('REJECTED', 'FAILED') or "failure_code" is not null),
        constraint "wager_tx_positive_amount_moves_balance"
          check ("kind" = 'LOSS' or "amount" > 0)
      );
    `);

    // A reference is reverted at most once (OLD_README §7 rule 4). Stricter reading adopted:
    // REFUND and ROLLBACK share the slot, so a BET can never be credited back twice.
    this.addSql(`
      create unique index "wager_tx_single_reversal"
        on "wager_transactions" ("reference_transaction_id")
        where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');
    `);
    this.addSql(`
      create index "wager_tx_pending_reference_due"
        on "wager_transactions" ("next_reference_attempt_at")
        where "status" = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id"                    char(16)      primary key,
        "wallet_id"             char(16)      not null references "wallets" ("id"),
        -- DEFERRABLE: checked at COMMIT, so insert order inside the transaction does not matter
        "transaction_id"        char(16)      not null
          references "wager_transactions" ("id") deferrable initially deferred,
        "direction"             text          not null check ("direction" in ('DEBIT', 'CREDIT')),
        "amount"                numeric(19,2) not null check ("amount" > 0),
        "balance_before_amount" numeric(19,2) not null check ("balance_before_amount" >= 0),
        "balance_after_amount"  numeric(19,2) not null check ("balance_after_amount" >= 0),
        "currency"              char(3)       not null,
        "created_at"            timestamptz   not null,
        constraint "ledger_one_entry_per_transaction" unique ("transaction_id", "wallet_id"),
        constraint "ledger_entry_is_balanced" check (
          ("direction" = 'CREDIT' and "balance_after_amount" = "balance_before_amount" + "amount") or
          ("direction" = 'DEBIT'  and "balance_after_amount" = "balance_before_amount" - "amount")
        )
      );
    `);
    this.addSql(`
      create index "ledger_wallet_page"
        on "wallet_ledger_entries" ("wallet_id", "created_at" desc, "id" desc);
    `);

    // The ledger is append-only: the database itself refuses UPDATE and DELETE (OLD_README §5.5).
    this.addSql(`
      create function "forbid_mutation"() returns trigger language plpgsql as $$
      begin
        raise exception '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
      end;
      $$;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_append_only"
        before update or delete on "wallet_ledger_entries"
        for each row execute function "forbid_mutation"();
    `);

    this.addSql(`
      create table "inbox_messages" (
        "id"            char(16)    primary key,
        "message_id"    text        not null,
        "consumer_name" text        not null,
        "payload_hash"  char(64)    not null,
        "created_at"    timestamptz not null,
        "updated_at"    timestamptz not null,
        "processed_at"  timestamptz,
        constraint "inbox_consumer_message_unique" unique ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      create table "outbox_messages" (
        "id"              char(16)    primary key,
        "aggregate_id"    char(16)    not null,
        "event_type"      text        not null,
        "payload"         jsonb       not null,
        "occurred_at"     timestamptz not null,
        "attempts"        integer     not null default 0 check ("attempts" >= 0),
        "next_attempt_at" timestamptz not null,
        "published_at"    timestamptz,
        "created_at"      timestamptz not null,
        "updated_at"      timestamptz not null
      );
    `);
    this.addSql(`
      create index "outbox_pending_due"
        on "outbox_messages" ("next_attempt_at")
        where "published_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_messages";`);
    this.addSql(`drop table if exists "inbox_messages";`);
    this.addSql(`drop trigger if exists "wallet_ledger_entries_append_only" on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "forbid_mutation"();`);
    this.addSql(`drop table if exists "wallet_ledger_entries";`);
    this.addSql(`drop table if exists "wager_transactions";`);
    this.addSql(`drop table if exists "wallets";`);
  }
}
