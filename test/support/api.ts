import { http } from "./app";
import { unique } from "./factories";

export interface WalletFixture {
  id: string;
  playerId: string;
}

export const createWallet = async (url: string, amount = "100.00", playerId = unique("player")): Promise<WalletFixture> => {
  const response = await http(url, "POST", "/wallets", { playerId, initialBalance: { amount, currency: "BRL" } });
  if (response.status !== 201) throw new Error(`createWallet failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { id: response.body.id, playerId };
};

export interface WagerOptions {
  kind?: string;
  amount?: string;
  currency?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  reference?: string;
  roundId?: string;
  providerId?: string;
  playerId?: string;
}

export const wagerBody = (wallet: WalletFixture, options: WagerOptions = {}) => {
  const externalTransactionId = options.externalTransactionId ?? unique("tx");
  const providerId = options.providerId ?? "provider-a";
  return {
    body: {
      providerId,
      externalTransactionId,
      playerId: options.playerId ?? wallet.playerId,
      walletId: wallet.id,
      roundId: options.roundId ?? "round-1",
      gameId: "fortune-chimp",
      kind: options.kind ?? "BET",
      money: { amount: options.amount ?? "25.00", currency: options.currency ?? "BRL" },
      ...(options.reference ? { referenceExternalTransactionId: options.reference } : {}),
    },
    idempotencyKey: options.idempotencyKey ?? `${providerId}:${externalTransactionId}`,
  };
};

export const submit = async (url: string, wallet: WalletFixture, options: WagerOptions = {}) => {
  const { body, idempotencyKey } = wagerBody(wallet, options);
  const response = await http(url, "POST", "/wagering/transactions", body, { "Idempotency-Key": idempotencyKey });
  return { ...response, request: body, idempotencyKey };
};

export const balanceOf = async (url: string, walletId: string): Promise<string> =>
  (await http(url, "GET", `/wallets/${walletId}`)).body.balance.amount;
