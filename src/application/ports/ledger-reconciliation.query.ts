const LEDGER_RECONCILIATION_QUERY = Symbol("LEDGER_RECONCILIATION_QUERY");

interface LedgerTotals {
  /** Σ CREDIT − Σ DEBIT as a decimal string with 2 places (may be negative). */
  calculated: string;
  checkedEntries: number;
}

interface LedgerReconciliationQuery {
  totals(walletId: string): Promise<LedgerTotals>;
}

export { LEDGER_RECONCILIATION_QUERY, LedgerTotals, LedgerReconciliationQuery };
