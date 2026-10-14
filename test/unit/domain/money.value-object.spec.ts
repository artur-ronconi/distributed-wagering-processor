import { describe, expect, it } from "bun:test";

import { MoneyValueObject } from "../../../src/domain/money/money.value-object";
import { CurrencyMismatchError } from "../../../src/domain/money/money.errors";
import { type IDomainError } from "../../../src/domain/shared/domain-error";
import { FailureCode } from "../../../src/domain/shared/failure-code";
import { brl, money } from "../../support/money";

describe("MoneyValueObject", () => {
  describe("from", () => {
    it.each(["0.00", "0.05", "25.00", "1000.10", "99999999999999999.99"])("accepts %s", (amount) => {
      const output = MoneyValueObject.from({ amount, currency: "BRL" });

      expect(output.isSuccess).toBe(true);
      expect((output.result as MoneyValueObject).toString()).toBe(amount);
    });

    it.each([
      "25",
      "25.0",
      "25.005",
      "025.00",
      "-1.00",
      "1e3",
      "1e3.00",
      "NaN",
      "Infinity",
      "",
      " 25.00",
      "25.00 ",
      "25,00",
      "+25.00",
      "100000000000000000.00",
    ])("rejects amount %p", (amount) => {
      const output = MoneyValueObject.from({ amount, currency: "BRL" });

      expect(output.isFailure).toBe(true);
      expect((output.result as IDomainError).code).toBe(FailureCode.InvalidPayload);
    });

    it.each(["brl", "BR", "BRLL", "", "B1L"])("rejects currency %p", (currency) => {
      expect(MoneyValueObject.from({ amount: "1.00", currency }).isFailure).toBe(true);
    });

    it("rejects non-string input without throwing", () => {
      const output = MoneyValueObject.from({ amount: 25 as unknown as string, currency: "BRL" });
      expect(output.isFailure).toBe(true);
    });
  });

  describe("arithmetic", () => {
    it("adds and subtracts exactly, without floating point drift", () => {
      expect(brl("0.10").add(brl("0.20")).toString()).toBe("0.30");
      expect(brl("100.00").subtract(brl("80.00")).toString()).toBe("20.00");
    });

    it("can become negative internally", () => {
      const result = brl("10.00").subtract(brl("25.50"));

      expect(result.isNegative()).toBe(true);
      expect(result.toString()).toBe("-15.50");
    });

    it("negates", () => {
      expect(brl("0.05").negate().toString()).toBe("-0.05");
      expect(brl("0.05").negate().negate().equals(brl("0.05"))).toBe(true);
    });

    it("is immutable", () => {
      const original = brl("10.00");
      original.add(brl("5.00"));
      original.subtract(brl("1.00"));
      original.negate();

      expect(original.toString()).toBe("10.00");
    });

    it("compares", () => {
      expect(brl("1.00").isLessThan(brl("1.01"))).toBe(true);
      expect(brl("1.01").isLessThan(brl("1.00"))).toBe(false);
      expect(brl("1.00").equals(brl("1.00"))).toBe(true);
      expect(brl("1.00").equals(money("1.00", "USD"))).toBe(false);
      expect(MoneyValueObject.zero("BRL").isZero()).toBe(true);
      expect(brl("0.01").isPositive()).toBe(true);
    });
  });

  describe("currency conflict", () => {
    it.each([
      ["add", (a: MoneyValueObject, b: MoneyValueObject) => a.add(b)],
      ["subtract", (a: MoneyValueObject, b: MoneyValueObject) => a.subtract(b)],
      ["isLessThan", (a: MoneyValueObject, b: MoneyValueObject) => a.isLessThan(b)],
    ] as const)("%s throws CurrencyMismatchError", (_name, operation) => {
      expect(() => operation(brl("1.00"), money("1.00", "USD"))).toThrow(CurrencyMismatchError);
    });
  });

  it("serializes back to the contract shape", () => {
    expect(brl("25.00").toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
  });
});
