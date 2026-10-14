import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

const INVALID_WALLET: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid wallet data.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const WALLET_NOT_FOUND: IDomainError = {
  code: FailureCode.WalletNotFound,
  message: "Wallet does not exist.",
  statusCode: HttpStatus.NOT_FOUND,
};

const WALLET_ALREADY_EXISTS: IDomainError = {
  code: FailureCode.WalletAlreadyExists,
  message: "The player already has a wallet in this currency.",
  statusCode: HttpStatus.CONFLICT,
};

const WALLET_CURRENCY_MISMATCH: IDomainError = {
  code: FailureCode.CurrencyMismatch,
  message: "Operation currency differs from the wallet currency.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const INVALID_MOVEMENT_AMOUNT: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Debit and credit amounts must be positive.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const INSUFFICIENT_FUNDS: IDomainError = {
  code: FailureCode.InsufficientFunds,
  message: "Wallet balance is not enough for this bet.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REVERSAL_WOULD_OVERDRAW: IDomainError = {
  code: FailureCode.ReversalWouldOverdraw,
  message: "Reversal rejected: the wallet balance would become negative.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

export {
  INVALID_WALLET,
  WALLET_NOT_FOUND,
  WALLET_ALREADY_EXISTS,
  WALLET_CURRENCY_MISMATCH,
  INVALID_MOVEMENT_AMOUNT,
  INSUFFICIENT_FUNDS,
  REVERSAL_WOULD_OVERDRAW,
};
