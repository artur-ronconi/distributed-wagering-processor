import { HttpStatus } from "ddd-tool-kit";
import { type IDomainError } from "../../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../../shared/domain/failure-code";

const INVALID_MONEY_AMOUNT: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: 'Amount must be a non-negative decimal string with exactly 2 decimal places, e.g. "25.00".',
  statusCode: HttpStatus.BAD_REQUEST,
};

const INVALID_MONEY_CURRENCY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: 'Currency must be an ISO-4217 code, e.g. "BRL".',
  statusCode: HttpStatus.BAD_REQUEST,
};

/** Programming error: the caller should have checked the currency first. */
class CurrencyMismatchError extends Error {
  constructor(expected: string, received: string) {
    super(`Cannot operate ${expected} with ${received}.`);
    this.name = "CurrencyMismatchError";
  }
}

export { INVALID_MONEY_AMOUNT, INVALID_MONEY_CURRENCY, CurrencyMismatchError };
