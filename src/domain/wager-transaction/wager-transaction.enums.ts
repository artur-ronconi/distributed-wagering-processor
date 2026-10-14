enum WagerTransactionKind {
  Opening = "OPENING", // internal: wallet opening credit
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

enum WagerTransactionStatus {
  Pending = "PENDING",                     // accepted, not applied yet
  PendingReference = "PENDING_REFERENCE",  // waiting for the referenced transaction
  Processed = "PROCESSED",                 // applied (terminal)
  Rejected = "REJECTED",                   // business rule violation (terminal)
  Failed = "FAILED",                       // permanent infrastructure error (terminal, auditable)
}

export { WagerTransactionKind, WagerTransactionStatus };
