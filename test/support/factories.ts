import { DateValueObject, IdValueObject } from "ddd-tool-kit";

import { WalletAggregate } from "../../src/domain/wallet/wallet.aggregate-root";
import { WagerTransactionAggregate } from "../../src/domain/wager-transaction/wager-transaction.aggregate-root";
import { WagerTransactionKind } from "../../src/domain/wager-transaction/wager-transaction.enums";
import { type ICreateWagerTransactionProps } from "../../src/domain/wager-transaction/wager-transaction.props";
import { brl } from "./money";

let sequence = 0;
export const unique = (prefix: string): string => `${prefix}-${Date.now()}-${(sequence += 1)}`;

/** Opens a wallet together with its OPENING transaction, like the CreateWallet use case. */
export const openWallet = (initialBalance = "100.00", playerId = unique("player")) => {
  const id = IdValueObject.getDefault();
  const opening = WagerTransactionAggregate.createOpening({
    walletId: id,
    playerId,
    money: brl(initialBalance),
    payloadHash: "0".repeat(64),
  });
  const wallet = WalletAggregate.open({
    id,
    playerId,
    initialBalance: brl(initialBalance),
    openingTransactionId: opening.id,
  }).result as WalletAggregate;
  return { wallet, opening };
};

export const wagerTransaction = (
  wallet: WalletAggregate,
  overrides: Partial<ICreateWagerTransactionProps> = {},
): WagerTransactionAggregate => {
  const externalTransactionId = overrides.externalTransactionId ?? unique("tx");
  const output = WagerTransactionAggregate.create({
    providerId: "provider-a",
    externalTransactionId,
    idempotencyKey: `provider-a:${externalTransactionId}`,
    payloadHash: "a".repeat(64),
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    ...overrides,
  });
  if (output.isFailure) throw new Error(JSON.stringify(output.result));
  return output.result as WagerTransactionAggregate;
};

export const now = (): DateValueObject => DateValueObject.getDefault();
