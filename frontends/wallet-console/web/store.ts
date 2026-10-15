import type { Kind, Money, SubmitInput, TxStatus } from "./api";

/**
 * Everything this console knows, kept in this browser only. The backend has no "list wallets"
 * route, and the console never asks for wallets it did not create: each browser is its own space.
 */

interface ConsoleWallet {
  id: string;
  playerId: string;
  nickname: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: string;
}

interface ConsoleTransaction {
  externalTransactionId: string;
  idempotencyKey: string;
  transactionId: string | null;
  walletId: string;
  kind: Kind;
  amount: string;
  currency: string;
  roundId: string;
  referenceExternalTransactionId: string | null;
  status: TxStatus | "ERROR";
  failureCode: string | null;
  observedBalance: string | null;
  httpStatus: number;
  replays: number;
  createdAt: string;
  updatedAt: string;
  /** Exactly what was sent, so "send again" repeats the same request. */
  payload: SubmitInput;
  /** Which route it went through: the wager route, or the wallet cashier (deposit/withdrawal). */
  channel?: "wager" | "cashier";
}

type RoundState = "open" | "won" | "lost" | "refunded" | "rolledback" | "rejected" | "pending";

interface Round {
  roundId: string;
  walletId: string;
  game: "mesa" | "moeda";
  betExternalTransactionId: string;
  amount: string;
  currency: string;
  state: RoundState;
  pick?: "cara" | "coroa";
  outcome?: "cara" | "coroa";
  createdAt: string;
}

interface Workspace {
  id: string;
  wallets: ConsoleWallet[];
  transactions: ConsoleTransaction[];
  rounds: Round[];
  selectedWalletId: string | null;
}

const KEY = "wallet-console:v1";

const randomToken = (length = 6) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
};

const empty = (): Workspace => ({ id: randomToken(4), wallets: [], transactions: [], rounds: [], selectedWalletId: null });

const load = (): Workspace => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {
    // storage blocked: start with an in-memory space
  }
  return empty();
};

let state = load();
const listeners = new Set<() => void>();

const commit = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore: the page still works for this visit
  }
  listeners.forEach((listener) => listener());
};

const now = () => new Date().toISOString();

const store = {
  get: () => state,
  onChange: (listener: () => void) => {
    listeners.add(listener);
  },

  selectedWallet: () => state.wallets.find((wallet) => wallet.id === state.selectedWalletId) ?? null,
  wallet: (id: string) => state.wallets.find((wallet) => wallet.id === id) ?? null,
  transactionsOf: (walletId: string) => state.transactions.filter((tx) => tx.walletId === walletId),
  roundsOf: (walletId: string) => state.rounds.filter((round) => round.walletId === walletId),
  transaction: (externalTransactionId: string) =>
    state.transactions.find((tx) => tx.externalTransactionId === externalTransactionId) ?? null,
  round: (roundId: string) => state.rounds.find((round) => round.roundId === roundId) ?? null,

  selectWallet(id: string) {
    state.selectedWalletId = id;
    commit();
  },

  addWallet(wallet: Omit<ConsoleWallet, "createdAt">) {
    state.wallets.unshift({ ...wallet, createdAt: now() });
    state.selectedWalletId = wallet.id;
    commit();
  },

  updateWallet(id: string, balance: Money, version: number) {
    const wallet = store.wallet(id);
    if (!wallet || (wallet.balance === balance.amount && wallet.version === version)) return;
    wallet.balance = balance.amount;
    wallet.version = version;
    commit();
  },

  upsertTransaction(tx: Omit<ConsoleTransaction, "createdAt" | "updatedAt" | "replays"> & { replays?: number }) {
    const existing = store.transaction(tx.externalTransactionId);
    if (existing) {
      Object.assign(existing, tx, { updatedAt: now(), replays: tx.replays ?? existing.replays });
    } else {
      state.transactions.unshift({ ...tx, replays: tx.replays ?? 0, createdAt: now(), updatedAt: now() });
    }
    commit();
  },

  addRound(round: Omit<Round, "createdAt">) {
    state.rounds.unshift({ ...round, createdAt: now() });
    commit();
  },

  updateRound(roundId: string, patch: Partial<Round>) {
    const round = store.round(roundId);
    if (!round) return;
    Object.assign(round, patch);
    commit();
  },

  /** Forgets this browser's space. The wallets stay in the backend, but this console no longer sees them. */
  reset() {
    state = empty();
    commit();
  },
};

export { randomToken, store, type ConsoleTransaction, type ConsoleWallet, type Round, type RoundState };
