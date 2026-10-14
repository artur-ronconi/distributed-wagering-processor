import { describe, expect, it } from "bun:test";
import { IdValueObject } from "ddd-tool-kit";

import { WalletAggregate } from "../../../src/modules/wallet/domain/aggregate/aggregate-root/wallet.aggregate-root";
import { REVERSAL_WOULD_OVERDRAW } from "../../../src/modules/wallet/domain/aggregate/aggregate-root/wallet.errors";
import { LedgerDirection } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletLedgerEntryEntity } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { type IDomainError } from "../../../src/shared/domain/domain-error";
import { FailureCode } from "../../../src/shared/domain/failure-code";
import { brl, money } from "../../support/money";

const openWallet = (initialBalance = "100.00"): WalletAggregate => {
  const output = WalletAggregate.open({
    playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    initialBalance: brl(initialBalance),
    openingTransactionId: IdValueObject.getDefault(),
  });
  if (output.isFailure) throw new Error("could not open wallet");
  const wallet = output.result as WalletAggregate;
  wallet.pullNewLedgerEntries();
  return wallet;
};

const codeOf = (result: unknown): FailureCode => (result as IDomainError).code;

describe("WalletAggregate", () => {
  describe("open", () => {
    it("starts at version 1 with an OPENING credit entry when the initial balance is positive", () => {
      const openingTransactionId = IdValueObject.getDefault();
      const output = WalletAggregate.open({
        playerId: "player-1",
        initialBalance: brl("1000.00"),
        openingTransactionId,
      });
      const wallet = output.result as WalletAggregate;
      const [entry] = wallet.newLedgerEntries;

      expect(output.isSuccess).toBe(true);
      expect(wallet.version).toBe(1);
      expect(wallet.balance.toString()).toBe("1000.00");
      expect(wallet.currency).toBe("BRL");
      expect(wallet.newLedgerEntries).toHaveLength(1);
      expect(entry?.direction).toBe(LedgerDirection.Credit);
      expect(entry?.balanceBefore.toString()).toBe("0.00");
      expect(entry?.balanceAfter.toString()).toBe("1000.00");
      expect(entry?.transactionId.equals(openingTransactionId)).toBe(true);
    });

    it("creates no entry when the initial balance is zero", () => {
      const output = WalletAggregate.open({
        playerId: "player-1",
        initialBalance: brl("0.00"),
        openingTransactionId: IdValueObject.getDefault(),
      });

      expect((output.result as WalletAggregate).newLedgerEntries).toHaveLength(0);
    });

    it("rejects an empty player id", () => {
      const output = WalletAggregate.open({
        playerId: "  ",
        initialBalance: brl("10.00"),
        openingTransactionId: IdValueObject.getDefault(),
      });

      expect(output.isFailure).toBe(true);
      expect(codeOf(output.result)).toBe(FailureCode.InvalidPayload);
    });
  });

  describe("debit", () => {
    it("debits, bumps the version and records a balanced DEBIT entry", () => {
      const wallet = openWallet("100.00");
      const output = wallet.debit(brl("25.00"), IdValueObject.getDefault());
      const entry = output.result as WalletLedgerEntryEntity;

      expect(output.isSuccess).toBe(true);
      expect(wallet.balance.toString()).toBe("75.00");
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.balanceBefore.toString()).toBe("100.00");
      expect(entry.balanceAfter.toString()).toBe("75.00");
      expect(entry.isBalanced()).toBe(true);
      expect(wallet.newLedgerEntries).toEqual([entry]);
    });

    it("allows debiting the whole balance", () => {
      const wallet = openWallet("80.00");

      expect(wallet.debit(brl("80.00"), IdValueObject.getDefault()).isSuccess).toBe(true);
      expect(wallet.balance.isZero()).toBe(true);
    });

    it("rejects with INSUFFICIENT_FUNDS and changes nothing", () => {
      const wallet = openWallet("100.00");
      wallet.debit(brl("80.00"), IdValueObject.getDefault());

      const output = wallet.debit(brl("80.00"), IdValueObject.getDefault());

      expect(output.isFailure).toBe(true);
      expect(codeOf(output.result)).toBe(FailureCode.InsufficientFunds);
      expect(wallet.balance.toString()).toBe("20.00");
      expect(wallet.version).toBe(2);
      expect(wallet.newLedgerEntries).toHaveLength(1);
    });

    it("reports REVERSAL_WOULD_OVERDRAW when the caller asks for it", () => {
      const wallet = openWallet("10.00");
      const output = wallet.debit(brl("50.00"), IdValueObject.getDefault(), REVERSAL_WOULD_OVERDRAW);

      expect(codeOf(output.result)).toBe(FailureCode.ReversalWouldOverdraw);
    });
  });

  describe("credit", () => {
    it("credits and bumps the version", () => {
      const wallet = openWallet("100.00");
      const output = wallet.credit(brl("50.00"), IdValueObject.getDefault());

      expect(output.isSuccess).toBe(true);
      expect(wallet.balance.toString()).toBe("150.00");
      expect(wallet.version).toBe(2);
      expect((output.result as WalletLedgerEntryEntity).direction).toBe(LedgerDirection.Credit);
    });
  });

  describe("invalid movements change nothing", () => {
    it.each([
      ["currency mismatch", () => money("10.00", "USD"), FailureCode.CurrencyMismatch],
      ["zero amount", () => brl("0.00"), FailureCode.InvalidAmount],
    ] as const)("%s", (_name, amount, code) => {
      const wallet = openWallet("100.00");

      for (const movement of [
        wallet.debit(amount(), IdValueObject.getDefault()),
        wallet.credit(amount(), IdValueObject.getDefault()),
      ]) {
        expect(movement.isFailure).toBe(true);
        expect(codeOf(movement.result)).toBe(code);
      }
      expect(wallet.balance.toString()).toBe("100.00");
      expect(wallet.version).toBe(1);
      expect(wallet.newLedgerEntries).toHaveLength(0);
    });
  });

  it("rehydrate starts without new entries and does not revalidate", () => {
    const wallet = WalletAggregate.rehydrate({
      id: IdValueObject.getDefault(),
      playerId: "player-1",
      currency: "BRL",
      balance: brl("20.00"),
      version: 7,
    });

    expect(wallet.newLedgerEntries).toHaveLength(0);
    expect(wallet.version).toBe(7);
  });

  it("pullNewLedgerEntries returns the entries and empties the list", () => {
    const wallet = openWallet("100.00");
    wallet.debit(brl("1.00"), IdValueObject.getDefault());
    wallet.credit(brl("2.00"), IdValueObject.getDefault());

    expect(wallet.pullNewLedgerEntries()).toHaveLength(2);
    expect(wallet.newLedgerEntries).toHaveLength(0);
  });

  it("keeps balance == ledger after many movements", () => {
    const wallet = openWallet("0.00");
    const entries: WalletLedgerEntryEntity[] = [];
    const movements = ["10.00", "-3.50", "7.25", "-13.75", "100.00", "-0.01"];

    for (const movement of movements) {
      const output = movement.startsWith("-")
        ? wallet.debit(brl(movement.slice(1)), IdValueObject.getDefault())
        : wallet.credit(brl(movement), IdValueObject.getDefault());
      entries.push(output.result as WalletLedgerEntryEntity);
    }

    const rebuilt = entries.reduce(
      (sum, entry) => (entry.direction === LedgerDirection.Credit ? sum.add(entry.money) : sum.subtract(entry.money)),
      brl("0.00"),
    );
    expect(rebuilt.equals(wallet.balance)).toBe(true);
    expect(wallet.balance.toString()).toBe("99.99");
  });
});
