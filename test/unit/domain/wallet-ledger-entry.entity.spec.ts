import { describe, expect, it } from "bun:test";
import { IdValueObject } from "ddd-tool-kit";

import { WalletLedgerEntryEntity } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { LedgerDirection } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { MoneyValueObject } from "../../../src/modules/wallet/domain/aggregate/value-objects/money/money.value-object";
import { brl, money } from "../../support/money";

const create = (
  direction: LedgerDirection,
  amount: MoneyValueObject,
  before: MoneyValueObject,
  after: MoneyValueObject,
) =>
  WalletLedgerEntryEntity.create({
    walletId: IdValueObject.getDefault(),
    transactionId: IdValueObject.getDefault(),
    direction,
    money: amount,
    balanceBefore: before,
    balanceAfter: after,
  });

describe("WalletLedgerEntryEntity", () => {
  it("accepts balanced entries", () => {
    expect(create(LedgerDirection.Credit, brl("25.00"), brl("100.00"), brl("125.00")).isSuccess).toBe(true);
    expect(create(LedgerDirection.Debit, brl("25.00"), brl("100.00"), brl("75.00")).isSuccess).toBe(true);
  });

  it.each([
    ["wrong arithmetic", LedgerDirection.Credit, brl("25.00"), brl("100.00"), brl("124.99")],
    ["zero amount", LedgerDirection.Credit, brl("0.00"), brl("100.00"), brl("100.00")],
    ["negative balance after", LedgerDirection.Debit, brl("25.00"), brl("10.00"), brl("10.00").subtract(brl("25.00"))],
    ["mixed currencies", LedgerDirection.Credit, money("25.00", "USD"), brl("100.00"), brl("125.00")],
  ] as const)("rejects %s", (_name, direction, amount, before, after) => {
    expect(create(direction, amount, before, after).isFailure).toBe(true);
  });

  it("is structurally immutable", () => {
    const entry = create(LedgerDirection.Debit, brl("25.00"), brl("100.00"), brl("75.00"))
      .result as WalletLedgerEntryEntity;

    expect(() => {
      (entry as unknown as { props: { balanceAfter: MoneyValueObject } }).props.balanceAfter = brl("999.00");
    }).toThrow(TypeError);
    expect(entry.balanceAfter.toString()).toBe("75.00");
  });
});
