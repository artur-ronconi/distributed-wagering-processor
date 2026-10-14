import { HttpStatus } from "ddd-tool-kit";
import { type IDomainError } from "../shared/domain-error";
import { FailureCode } from "../shared/failure-code";

const INVALID_WAGER_TRANSACTION: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid wager transaction: missing or empty fields.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const OPENING_NOT_ALLOWED: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "OPENING is internal and cannot be submitted.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const REFERENCE_REQUIRED: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "REFUND and ROLLBACK require referenceExternalTransactionId.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const INVALID_WAGER_AMOUNT: IDomainError = {
  code: FailureCode.InvalidAmount,
  message: "Amount must be positive (LOSS accepts 0.00).",
  statusCode: HttpStatus.BAD_REQUEST,
};

const IDEMPOTENCY_CONFLICT: IDomainError = {
  code: FailureCode.IdempotencyConflict,
  message: "Idempotency-Key already used with a different payload.",
  statusCode: HttpStatus.CONFLICT,
};

const TRANSACTION_NOT_FOUND: IDomainError = {
  code: FailureCode.TransactionNotFound,
  message: "Wager transaction does not exist.",
  statusCode: HttpStatus.NOT_FOUND,
};

const WALLET_PLAYER_MISMATCH: IDomainError = {
  code: FailureCode.WalletPlayerMismatch,
  message: "The wallet does not belong to this player.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_NOT_FOUND: IDomainError = {
  code: FailureCode.ReferenceNotFound,
  message: "Referenced transaction was not received within the retry limit.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_KIND_NOT_ALLOWED: IDomainError = {
  code: FailureCode.ReferenceKindNotAllowed,
  message: "REFUND references only BET; ROLLBACK references BET, WIN or REFUND; WIN references only BET.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_MISMATCH: IDomainError = {
  code: FailureCode.ReferenceMismatch,
  message: "Reference must have the same provider, player, wallet, currency and round.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_AMOUNT_MISMATCH: IDomainError = {
  code: FailureCode.ReferenceAmountMismatch,
  message: "Reversal amount must equal the referenced amount.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_NOT_PROCESSED: IDomainError = {
  code: FailureCode.ReferenceNotProcessed,
  message: "Referenced transaction is not PROCESSED.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

const REFERENCE_ALREADY_REVERSED: IDomainError = {
  code: FailureCode.ReferenceAlreadyReversed,
  message: "Referenced transaction was already reverted by this kind of operation.",
  statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** Programming error: transition not allowed from the current status. */
class InvalidTransactionStateError extends Error {
  constructor(transactionId: string, from: string, to: string) {
    super(`WagerTransaction ${transactionId} cannot go from ${from} to ${to}.`);
    this.name = "InvalidTransactionStateError";
  }
}

export {
  INVALID_WAGER_TRANSACTION,
  OPENING_NOT_ALLOWED,
  REFERENCE_REQUIRED,
  INVALID_WAGER_AMOUNT,
  IDEMPOTENCY_CONFLICT,
  TRANSACTION_NOT_FOUND,
  WALLET_PLAYER_MISMATCH,
  REFERENCE_NOT_FOUND,
  REFERENCE_KIND_NOT_ALLOWED,
  REFERENCE_MISMATCH,
  REFERENCE_AMOUNT_MISMATCH,
  REFERENCE_NOT_PROCESSED,
  REFERENCE_ALREADY_REVERSED,
  InvalidTransactionStateError,
};
