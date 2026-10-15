/** The backend's public HTTP API, through the console's proxy (/api → :3000). */

interface Money {
  amount: string;
  currency: string;
}

interface WalletView {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
}

interface TransactionResult {
  transactionId: string;
  status: TxStatus;
  balance: Money | null;
  failureCode: string | null;
  idempotentReplay: boolean;
}

interface TransactionView {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  kind: Kind;
  money: Money;
  referenceExternalTransactionId: string | null;
  status: TxStatus;
  failureCode: string | null;
  balance: Money | null;
  processedAt: string | null;
  createdAt: string;
}

interface LedgerEntry {
  id: string;
  transactionId: string;
  direction: "DEBIT" | "CREDIT";
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: string;
}

interface Reconciliation {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

interface ApiError {
  code: string;
  message: string;
  correlationId?: string;
}

type Kind = "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK" | "DEPOSIT" | "WITHDRAWAL";
type TxStatus = "PENDING" | "PENDING_REFERENCE" | "PROCESSED" | "REJECTED" | "FAILED";

interface Call<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: ApiError | null;
  method: string;
  path: string;
  requestBody?: unknown;
  headers: Record<string, string>;
  durationMs: number;
}

const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Call<T>> => {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: "NETWORK", message: (error as Error).message },
      method,
      path,
      requestBody: body,
      headers,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { code: "NOT_JSON", message: text.slice(0, 200) };
  }
  const ok = response.ok;
  return {
    ok,
    status: response.status,
    // 422 is a business result (REJECTED) with the transaction in the body, not an error envelope.
    data: ok || response.status === 422 ? (json as T) : null,
    error: ok || response.status === 422 ? null : (json as ApiError),
    method,
    path,
    requestBody: body,
    headers,
    durationMs: Math.round(performance.now() - startedAt),
  };
};

interface SubmitInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Kind;
  money: Money;
  referenceExternalTransactionId?: string;
}

const api = {
  health: () => call<{ status: string }>("GET", "/health/ready"),
  createWallet: (playerId: string, initialBalance: Money) => call<WalletView>("POST", "/wallets", { playerId, initialBalance }),
  wallet: (id: string) => call<WalletView>("GET", `/wallets/${encodeURIComponent(id)}`),
  ledger: (id: string, cursor?: string, limit = 20) =>
    call<{ items: LedgerEntry[]; nextCursor: string | null }>(
      "GET",
      `/wallets/${encodeURIComponent(id)}/ledger?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  reconcile: (id: string) => call<Reconciliation>("POST", `/wallets/${encodeURIComponent(id)}/reconciliation`),
  submit: (input: SubmitInput) => {
    const { idempotencyKey, referenceExternalTransactionId, ...rest } = input;
    const body = referenceExternalTransactionId ? { ...rest, referenceExternalTransactionId } : rest;
    return call<TransactionResult>("POST", "/wagering/transactions", body, { "Idempotency-Key": idempotencyKey });
  },
  /** Cashier operations: the Idempotency-Key is scoped to the wallet. */
  deposit: (walletId: string, money: Money, idempotencyKey: string) =>
    call<TransactionResult>("POST", `/wallets/${encodeURIComponent(walletId)}/deposits`, { money }, { "Idempotency-Key": idempotencyKey }),
  withdraw: (walletId: string, money: Money, idempotencyKey: string) =>
    call<TransactionResult>("POST", `/wallets/${encodeURIComponent(walletId)}/withdrawals`, { money }, { "Idempotency-Key": idempotencyKey }),
  transaction: (providerId: string, externalTransactionId: string) =>
    call<TransactionView>(
      "GET",
      `/providers/${encodeURIComponent(providerId)}/wagering/transactions/${encodeURIComponent(externalTransactionId)}`,
    ),
};

export {
  api,
  type ApiError,
  type Call,
  type Kind,
  type LedgerEntry,
  type Money,
  type Reconciliation,
  type SubmitInput,
  type TransactionResult,
  type TransactionView,
  type TxStatus,
  type WalletView,
};
