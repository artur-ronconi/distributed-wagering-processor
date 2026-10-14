enum FailureCode {
  InvalidPayload = "INVALID_PAYLOAD",
  IdempotencyConflict = "IDEMPOTENCY_CONFLICT",
  WalletAlreadyExists = "WALLET_ALREADY_EXISTS",
  WalletNotFound = "WALLET_NOT_FOUND",
  TransactionNotFound = "TRANSACTION_NOT_FOUND",
  WalletPlayerMismatch = "WALLET_PLAYER_MISMATCH",
  CurrencyMismatch = "CURRENCY_MISMATCH",
  InvalidAmount = "INVALID_AMOUNT",
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ReversalWouldOverdraw = "REVERSAL_WOULD_OVERDRAW",
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceKindNotAllowed = "REFERENCE_KIND_NOT_ALLOWED",
  ReferenceMismatch = "REFERENCE_MISMATCH",
  ReferenceAmountMismatch = "REFERENCE_AMOUNT_MISMATCH",
  ReferenceNotProcessed = "REFERENCE_NOT_PROCESSED",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  TransientFailure = "TRANSIENT_FAILURE",
  InternalError = "INTERNAL_ERROR",
}

export { FailureCode };
