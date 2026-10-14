import { type MoneyProps } from "../../domain/money/money.props";
import { LedgerDirection } from "../../domain/wallet-ledger-entry/wallet-ledger-entry.props";

const WALLET_LEDGER_QUERY = Symbol("WALLET_LEDGER_QUERY");

interface LedgerCursor {
  createdAt: Date;
  id: string;
}

interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

/** Read side: the ledger history never goes through the Wallet aggregate. */
interface WalletLedgerQuery {
  /** Newest first, strictly after `after` when given. Returns up to `limit` items. */
  page(walletId: string, after: LedgerCursor | null, limit: number): Promise<LedgerEntryView[]>;
}

export { WALLET_LEDGER_QUERY, type LedgerCursor, type LedgerEntryView, type WalletLedgerQuery };
