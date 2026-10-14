import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";

import { type LedgerCursor, type LedgerEntryView, type WalletLedgerQuery } from "../../../domain/services/wallet-ledger.query";
import { LedgerDirection } from "../../../domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";

interface LedgerRow {
  id: string;
  transaction_id: string;
  direction: string;
  amount: string;
  balance_before_amount: string;
  balance_after_amount: string;
  currency: string;
  created_at: Date;
}

@Injectable()
class MikroOrmWalletLedgerQuery implements WalletLedgerQuery {
  constructor(private readonly em: EntityManager) {}

  async page(walletId: string, after: LedgerCursor | null, limit: number): Promise<LedgerEntryView[]> {
    // Keyset pagination: stable even while new entries are appended (never OFFSET).
    const rows = await this.em.execute<LedgerRow[]>(
      `select "id", "transaction_id", "direction", "amount", "balance_before_amount",
              "balance_after_amount", "currency", "created_at"
       from "wallet_ledger_entries"
       where "wallet_id" = ?
         ${after ? `and ("created_at", "id") < (?, ?)` : ""}
       order by "created_at" desc, "id" desc
       limit ?`,
      after ? [walletId, after.createdAt, after.id, limit] : [walletId, limit],
    );

    return rows.map((row) => {
      const currency = row.currency.trim();
      return {
        id: row.id.trim(),
        transactionId: row.transaction_id.trim(),
        direction: row.direction as LedgerDirection,
        money: { amount: row.amount, currency },
        balanceBefore: { amount: row.balance_before_amount, currency },
        balanceAfter: { amount: row.balance_after_amount, currency },
        createdAt: new Date(row.created_at),
      };
    });
  }
}

export { MikroOrmWalletLedgerQuery };
