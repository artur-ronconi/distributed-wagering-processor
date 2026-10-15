/** What this browser session created, so forms can be filled with real ids. Kept in localStorage. */

interface SessionWallet {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
}

interface SessionTransaction {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  kind: string;
  amount: string;
  currency: string;
  status: string;
}

interface SessionState {
  wallets: SessionWallet[];
  transactions: SessionTransaction[];
  currentWalletId: string | null;
}

const KEY = "wagering-flow-visualizer";
const MAX_ITEMS = 30;

const load = (): SessionState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { wallets: [], transactions: [], currentWalletId: null, ...JSON.parse(raw) };
  } catch {
    // private mode or blocked storage: start empty
  }
  return { wallets: [], transactions: [], currentWalletId: null };
};

const state: SessionState = load();
const listeners = new Set<() => void>();

const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  listeners.forEach((listener) => listener());
};

const session = {
  get: () => state,
  currentWallet: (): SessionWallet | null => state.wallets.find((w) => w.id === state.currentWalletId) ?? state.wallets[0] ?? null,
  wallet: (id: string) => state.wallets.find((w) => w.id === id) ?? null,
  selectWallet(id: string) {
    state.currentWalletId = id;
    persist();
  },
  upsertWallet(wallet: SessionWallet) {
    state.wallets = [wallet, ...state.wallets.filter((w) => w.id !== wallet.id)].slice(0, MAX_ITEMS);
    state.currentWalletId = wallet.id;
    persist();
  },
  updateBalance(walletId: string, balance: string) {
    const wallet = state.wallets.find((w) => w.id === walletId);
    if (!wallet || wallet.balance === balance) return;
    wallet.balance = balance;
    persist();
  },
  upsertTransaction(tx: SessionTransaction) {
    state.transactions = [tx, ...state.transactions.filter((t) => t.transactionId !== tx.transactionId)].slice(0, MAX_ITEMS);
    persist();
  },
  clear() {
    state.wallets = [];
    state.transactions = [];
    state.currentWalletId = null;
    persist();
  },
  onChange(listener: () => void) {
    listeners.add(listener);
  },
};

const randomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const randomPlayer = () => crypto.randomUUID();

export { randomId, randomPlayer, session, type SessionTransaction, type SessionWallet };
