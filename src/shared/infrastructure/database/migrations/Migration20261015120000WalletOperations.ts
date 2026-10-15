import { Migration } from "@mikro-orm/migrations";

const KINDS_BEFORE = `'OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'`;
const KINDS_AFTER = `${KINDS_BEFORE}, 'DEPOSIT', 'WITHDRAWAL'`;

/**
 * Deposits and withdrawals (POST /wallets/:walletId/deposits and /withdrawals) are stored as
 * wager_transactions of kind DEPOSIT / WITHDRAWAL, like the OPENING credit: same idempotency,
 * ledger, outbox and reconciliation. Internal kinds can only belong to the internal provider.
 */
export class Migration20261015120000WalletOperations extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_kind_check";`);
    this.addSql(`
      alter table "wager_transactions" add constraint "wager_transactions_kind_check"
        check ("kind" in (${KINDS_AFTER}));
    `);
    this.addSql(`
      alter table "wager_transactions" add constraint "wager_tx_internal_kinds_internal_provider"
        check ("kind" not in ('OPENING', 'DEPOSIT', 'WITHDRAWAL') or "provider_id" = 'internal');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint "wager_tx_internal_kinds_internal_provider";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_kind_check";`);
    // NOT VALID: deposits and withdrawals already stored (and their append-only ledger entries) stay
    // as they are; only new rows are checked against the old list. Reverting never deletes money history.
    this.addSql(`
      alter table "wager_transactions" add constraint "wager_transactions_kind_check"
        check ("kind" in (${KINDS_BEFORE})) not valid;
    `);
  }
}
