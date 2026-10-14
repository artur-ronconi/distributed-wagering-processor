import { describe, expect, it } from "bun:test";
import { DateValueObject, IdValueObject } from "ddd-tool-kit";

import { WalletAggregate } from "../../../src/modules/wallet/domain/aggregate/aggregate-root/wallet.aggregate-root";
import { WalletLedgerEntryEntity } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { WagerTransactionAggregate } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.aggregate-root";
import { WagerTransactionKind } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { FailureCode } from "../../../src/shared/domain/failure-code";
import { LedgerDirection } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletBalanceChanged } from "../../../src/modules/wallet/domain/events/wallet-balance-changed.event";
import { WagerTransactionProcessed } from "../../../src/modules/wager-transaction/domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../../src/modules/wager-transaction/domain/events/wager-transaction-rejected.event";
import { WagerTransactionPendingReference } from "../../../src/modules/wager-transaction/domain/events/wager-transaction-pending-reference.event";
import { OutboxMessageAggregate } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root";
import { brl } from "../../support/money";

const ctx = { correlationId: "corr-1", causationId: "msg-1", now: new Date("2026-07-29T15:00:00.000Z") };

const wallet = () => {
  const opened = WalletAggregate.open({
    playerId: "player-1",
    initialBalance: brl("100.00"),
    openingTransactionId: IdValueObject.getDefault(),
  }).result as WalletAggregate;
  opened.pullNewLedgerEntries();
  return opened;
};

const bet = (walletId: IdValueObject) =>
  WagerTransactionAggregate.create({
    providerId: "provider-a",
    externalTransactionId: "tx-1",
    idempotencyKey: "provider-a:tx-1",
    payloadHash: "h",
    walletId,
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
  }).result as WagerTransactionAggregate;

describe("integration events", () => {
  it("WalletBalanceChanged carries money as strings and the wallet version", () => {
    const w = wallet();
    const entry = w.debit(brl("25.00"), IdValueObject.getDefault()).result as WalletLedgerEntryEntity;
    const json = WalletBalanceChanged.from(w, entry, ctx).toJSON();

    expect(json.eventType).toBe("WalletBalanceChanged");
    expect(json.version).toBe(1);
    expect(json.occurredAt).toBe("2026-07-29T15:00:00.000Z");
    expect(json.correlationId).toBe("corr-1");
    expect(json.causationId).toBe("msg-1");
    expect(json.data).toEqual({
      walletId: w.id.value,
      transactionId: entry.transactionId.value,
      direction: LedgerDirection.Debit,
      money: { amount: "25.00", currency: "BRL" },
      balanceBefore: { amount: "100.00", currency: "BRL" },
      balanceAfter: { amount: "75.00", currency: "BRL" },
      walletVersion: 2,
    });
  });

  it("transaction events have the right type and data", () => {
    const w = wallet();
    const processed = bet(w.id);
    processed.markProcessed(undefined, DateValueObject.getDefault(), brl("75.00"));
    const rejected = bet(w.id);
    rejected.reject(FailureCode.InsufficientFunds, DateValueObject.getDefault(), brl("10.00"));
    const pending = bet(w.id);
    pending.markPendingReference(DateValueObject.getDefault());

    expect(WagerTransactionProcessed.from(processed, ctx).toJSON().data.balance).toEqual({
      amount: "75.00",
      currency: "BRL",
    });
    expect(WagerTransactionRejected.from(rejected, ctx).toJSON().data.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(WagerTransactionPendingReference.from(pending, ctx).toJSON().eventType).toBe(
      "WagerTransactionPendingReference",
    );
  });

  it("every event gets a unique 16-char id accepted by the outbox", () => {
    const w = wallet();
    const tx = bet(w.id);
    tx.markProcessed(undefined, DateValueObject.getDefault(), brl("75.00"));
    const a = WagerTransactionProcessed.from(tx, ctx);
    const b = WagerTransactionProcessed.from(tx, ctx);

    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventId).toHaveLength(16);
    expect(OutboxMessageAggregate.enqueue(a).isSuccess).toBe(true);
  });
});
