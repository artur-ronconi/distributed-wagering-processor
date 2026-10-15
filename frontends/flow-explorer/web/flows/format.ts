import type { Row, Snapshot } from "../api";

const money = (amount: unknown, currency?: unknown) =>
  amount === null || amount === undefined ? "—" : `${amount}${currency ? ` ${String(currency).trim()}` : ""}`;

const walletLine = (wallet: Row | null | undefined) =>
  wallet ? `saldo ${money(wallet.balanceAmount, wallet.currency)} · version ${wallet.version}` : "carteira não existe";

const short = (id: unknown) => (typeof id === "string" ? id : "—");

const ms = (from: unknown, to: unknown) => {
  const a = new Date(String(from)).getTime();
  const b = new Date(String(to)).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
};

/** wallet.balance == balance rebuilt from the ledger (the invariant every test checks). */
const invariant = (snapshot: Snapshot) => {
  if (!snapshot.wallet || !snapshot.ledgerTotals) return null;
  const stored = String(snapshot.wallet.balanceAmount);
  const calculated = snapshot.ledgerTotals.calculated;
  return { stored, calculated, ok: stored === calculated, entries: snapshot.ledgerTotals.entries };
};

const invariantNote = (snapshot: Snapshot) => {
  const check = invariant(snapshot);
  if (!check) return "";
  return check.ok
    ? `invariante ✓ saldo ${check.stored} = soma do ledger ${check.calculated} (${check.entries} lançamentos)`
    : `invariante ✗ saldo ${check.stored} ≠ ledger ${check.calculated}`;
};

/** Order the use cases insert events in: the transaction event first, then the balance change. */
const EMIT_ORDER = ["WagerTransactionProcessed", "WagerTransactionRejected", "WagerTransactionPendingReference", "WalletBalanceChanged"];
const byEmitOrder = <T extends { eventType?: unknown }>(rows: T[]) =>
  [...rows].sort((a, b) => EMIT_ORDER.indexOf(String(a.eventType)) - EMIT_ORDER.indexOf(String(b.eventType)));

export { byEmitOrder, invariant, invariantNote, money, ms, short, walletLine };
