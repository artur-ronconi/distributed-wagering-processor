import { activity } from "./activity";
import { api, type Call, type Kind, type SubmitInput, type TransactionResult } from "./api";
import { multiply } from "./money";
import { explainSubmit, KIND_LABEL, type Explanation } from "./rules";
import { randomToken, store, type ConsoleTransaction, type ConsoleWallet, type Round } from "./store";

const PROVIDER_ID = "wallet-console";
const GAME = { mesa: "mesa-livre", moeda: "cara-ou-coroa" } as const;

interface Outcome {
  call: Call<TransactionResult>;
  explanation: Explanation;
  tx: ConsoleTransaction | null;
}

const newRoundId = () => `round-${randomToken(6)}`;

/** A brand new request: new externalTransactionId and the Idempotency-Key derived from it. */
const buildInput = (
  wallet: ConsoleWallet,
  kind: Kind,
  amount: string,
  roundId: string,
  game: string,
  referenceExternalTransactionId?: string,
): SubmitInput => {
  const externalTransactionId = `${kind.toLowerCase()}-${randomToken(8)}`;
  return {
    providerId: PROVIDER_ID,
    externalTransactionId,
    idempotencyKey: `${PROVIDER_ID}:${externalTransactionId}`,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId,
    gameId: game,
    kind,
    money: { amount, currency: wallet.currency },
    referenceExternalTransactionId,
  };
};

const refreshWallet = async (walletId: string) => {
  const call = await api.wallet(walletId);
  if (call.ok && call.data) store.updateWallet(walletId, call.data.balance, call.data.version);
  return call;
};

const createWallet = async (nickname: string, currency: string, initialBalance: string) => {
  const playerId = `player-${randomToken(10)}`;
  const call = await api.createWallet(playerId, { amount: initialBalance, currency });
  const explanation: Explanation = call.ok
    ? {
        tone: "ok",
        title: "Carteira criada (201)",
        text:
          initialBalance === "0.00"
            ? "Carteira criada com saldo zero, versão 1."
            : `Carteira criada com ${initialBalance} ${currency}. O saldo inicial também gerou uma transação interna OPENING e o primeiro lançamento do extrato, então o saldo já nasce conferível pelo extrato.`,
      }
    : { tone: "fail", title: `${call.error?.code} (${call.status})`, text: call.error?.message ?? "" };
  activity.add(`Nova carteira "${nickname}"`, call, explanation);
  if (call.ok && call.data) {
    store.addWallet({
      id: call.data.id,
      playerId: call.data.playerId,
      nickname,
      currency: call.data.balance.currency,
      balance: call.data.balance.amount,
      version: call.data.version,
    });
  }
  return { call, explanation };
};

const isCashier = (kind: Kind) => kind === "DEPOSIT" || kind === "WITHDRAWAL";

/**
 * Sends one transaction, records what came back and refreshes the balance. Deposits and withdrawals go
 * to the wallet cashier routes, everything else to POST /wagering/transactions.
 */
const send = async (input: SubmitInput, title: string): Promise<Outcome> => {
  const cashier = isCashier(input.kind);
  const call = !cashier
    ? await api.submit(input)
    : input.kind === "DEPOSIT"
      ? await api.deposit(input.walletId, input.money, input.idempotencyKey)
      : await api.withdraw(input.walletId, input.money, input.idempotencyKey);
  const explanation = explainSubmit(call.status, call.data, call.error);
  activity.add(title, call, explanation);

  const result = call.data;
  const known = store.transaction(input.externalTransactionId);
  const replay = Boolean(result?.idempotentReplay);
  // A conflict on a key we already have must not overwrite the original record.
  const keepOriginal = known && !result;

  if (!keepOriginal) {
    store.upsertTransaction({
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      transactionId: result?.transactionId ?? null,
      walletId: input.walletId,
      kind: input.kind,
      amount: input.money.amount,
      currency: input.money.currency,
      roundId: input.roundId,
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
      status: result?.status ?? "ERROR",
      failureCode: result?.failureCode ?? call.error?.code ?? null,
      observedBalance: result?.balance?.amount ?? null,
      httpStatus: call.status,
      payload: input,
      replays: (known?.replays ?? 0) + (replay ? 1 : 0),
      channel: cashier ? "cashier" : "wager",
    });
  }
  if (store.wallet(input.walletId)) await refreshWallet(input.walletId);
  return { call, explanation, tx: store.transaction(input.externalTransactionId) };
};

/**
 * Deposit or withdrawal through the cashier routes. The backend scopes the key to the wallet and stores
 * the operation as an internal transaction with this externalTransactionId.
 */
const moveFunds = (wallet: ConsoleWallet, operation: "DEPOSIT" | "WITHDRAWAL", amount: string) => {
  const key = `console:${randomToken(8)}`;
  const input: SubmitInput = {
    providerId: "internal",
    externalTransactionId: `${operation.toLowerCase()}:${wallet.id}:${key}`,
    idempotencyKey: key,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "wallet-operation",
    gameId: "wallet",
    kind: operation,
    money: { amount, currency: wallet.currency },
  };
  return send(input, `${operation === "DEPOSIT" ? "Depósito" : "Saque"} de ${amount} ${wallet.currency}`);
};

const bet = async (wallet: ConsoleWallet, amount: string, game: Round["game"] = "mesa", pick?: Round["pick"]) => {
  const roundId = newRoundId();
  const input = buildInput(wallet, "BET", amount, roundId, GAME[game]);
  const outcome = await send(input, `Aposta de ${amount} ${wallet.currency}`);
  if (outcome.call.data) {
    store.addRound({
      roundId,
      walletId: wallet.id,
      game,
      betExternalTransactionId: input.externalTransactionId,
      amount,
      currency: wallet.currency,
      state: outcome.call.data.status === "PROCESSED" ? "open" : "rejected",
      pick,
    });
  }
  return outcome;
};

const settle = async (round: Round, kind: Kind, amount: string, reference?: string) => {
  const wallet = store.wallet(round.walletId);
  if (!wallet) throw new Error("carteira não encontrada neste espaço");
  const input = buildInput(wallet, kind, amount, round.roundId, GAME[round.game], reference);
  return send(input, `${KIND_LABEL[kind]} ${kind === "LOSS" ? "" : `de ${amount} ${wallet.currency} `}na rodada ${round.roundId}`);
};

const win = async (round: Round, amount: string) => {
  const outcome = await settle(round, "WIN", amount, round.betExternalTransactionId);
  if (outcome.tx?.status === "PROCESSED") store.updateRound(round.roundId, { state: "won" });
  return outcome;
};

/** LOSS goes without a reference: today the backend only accepts references on WIN, REFUND and ROLLBACK. */
const loss = async (round: Round) => {
  const outcome = await settle(round, "LOSS", "0.00");
  if (outcome.tx?.status === "PROCESSED") store.updateRound(round.roundId, { state: "lost" });
  return outcome;
};

const refund = async (round: Round) => {
  const outcome = await settle(round, "REFUND", round.amount, round.betExternalTransactionId);
  if (outcome.tx?.status === "PROCESSED") store.updateRound(round.roundId, { state: "refunded" });
  return outcome;
};

/** Undoes a BET, WIN or REFUND with the same amount, in the same round. */
const rollback = async (target: ConsoleTransaction) => {
  const round = store.round(target.roundId);
  const wallet = store.wallet(target.walletId);
  if (!wallet) throw new Error("carteira não encontrada neste espaço");
  const input = buildInput(wallet, "ROLLBACK", target.amount, target.roundId, target.payload.gameId, target.externalTransactionId);
  const outcome = await send(input, `Estorno de ${KIND_LABEL[target.kind]?.toLowerCase()} ${target.amount} ${target.currency}`);
  if (round && outcome.tx?.status === "PROCESSED") {
    store.updateRound(round.roundId, { state: target.kind === "BET" ? "rolledback" : "open" });
  }
  return outcome;
};

/** The exact same request again (same key, same body): the backend must answer with the original result. */
const resend = (tx: ConsoleTransaction) => send(tx.payload, `Reenvio de ${KIND_LABEL[tx.kind]?.toLowerCase()} (mesma key)`);

const flipCoin = (): "cara" | "coroa" => (crypto.getRandomValues(new Uint8Array(1))[0]! % 2 === 0 ? "cara" : "coroa");

/** Cara ou coroa: BET, then the coin decides WIN (2×) or LOSS. */
const coinFlip = async (wallet: ConsoleWallet, amount: string, pick: "cara" | "coroa") => {
  const placed = await bet(wallet, amount, "moeda", pick);
  if (placed.tx?.status !== "PROCESSED") return { placed, settled: null, outcome: null };
  const round = store.round(placed.tx.roundId);
  if (!round) return { placed, settled: null, outcome: null };

  const outcome = flipCoin();
  store.updateRound(round.roundId, { outcome });
  const settled = outcome === pick ? await win(round, multiply(amount, 2n)) : await loss(round);
  return { placed, settled, outcome };
};

/** Transactions waiting for their reference are resolved by a backend worker: ask how they are doing. */
const pollPending = async () => {
  const pending = store.get().transactions.filter((tx) => tx.status === "PENDING_REFERENCE");
  for (const tx of pending) {
    const call = await api.transaction(tx.payload.providerId, tx.externalTransactionId);
    const view = call.data;
    if (!call.ok || !view || view.status === tx.status) continue;

    store.upsertTransaction({
      ...tx,
      status: view.status,
      failureCode: view.failureCode,
      observedBalance: view.balance?.amount ?? null,
      transactionId: view.transactionId,
    });
    activity.add(`Worker resolveu ${KIND_LABEL[tx.kind]?.toLowerCase()} ${tx.externalTransactionId}`, call, {
      tone: view.status === "PROCESSED" ? "ok" : "fail",
      title: `${tx.externalTransactionId}: ${view.status}${view.failureCode ? ` · ${view.failureCode}` : ""}`,
      text:
        view.status === "PROCESSED"
          ? "A referência chegou e o worker de pendências aplicou a transação sozinho, sem ninguém reenviar nada."
          : "O worker desistiu ou a regra de negócio recusou quando a referência apareceu.",
    });
    if (view.status === "PROCESSED" && tx.kind === "ROLLBACK") {
      const target = tx.referenceExternalTransactionId ? store.transaction(tx.referenceExternalTransactionId) : null;
      if (target?.kind === "BET") store.updateRound(tx.roundId, { state: "rolledback" });
    }
    await refreshWallet(tx.walletId);
  }
};

export {
  bet,
  buildInput,
  coinFlip,
  createWallet,
  GAME,
  loss,
  moveFunds,
  newRoundId,
  pollPending,
  PROVIDER_ID,
  refreshWallet,
  refund,
  resend,
  rollback,
  send,
  win,
  type Outcome,
};
