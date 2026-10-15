import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";

import { type LedgerReconciliationQuery, type LedgerTotals } from "../../../domain/interfaces/ledger-reconciliation.query";

@Injectable()
class MikroOrmLedgerReconciliationQuery implements LedgerReconciliationQuery {
  constructor(private readonly em: EntityManager) {}

  async totals(walletId: string): Promise<LedgerTotals> {
    const [row] = await this.em.execute<Array<{ calculated: string; checked_entries: number }>>(
      `select
         coalesce(sum(case when "direction" = 'CREDIT' then "amount" else -"amount" end), 0)::numeric(19,2)::text
           as "calculated",
         count(*)::int as "checked_entries"
       from "wallet_ledger_entries"
       where "wallet_id" = ?`,
      [walletId],
    );

    return { calculated: row?.calculated ?? "0.00", checkedEntries: row?.checked_entries ?? 0 };
  }
}

export { MikroOrmLedgerReconciliationQuery };
