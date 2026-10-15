enum WagerTransactionKind {
  Opening = "OPENING", // internal: wallet opening credit
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
  Deposit = "DEPOSIT", // internal: money added to the wallet (POST /wallets/:walletId/deposits)
  Withdrawal = "WITHDRAWAL", // internal: money taken from the wallet (POST /wallets/:walletId/withdrawals)
}

/** What a game provider may submit (HTTP or SQS). Everything else is created by this service only. */
const PROVIDER_KINDS: readonly WagerTransactionKind[] = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

/** Wallet operations: move money in or out, outside a game round. */
type WalletOperationKind = WagerTransactionKind.Deposit | WagerTransactionKind.Withdrawal;

enum WagerTransactionStatus {
  Pending = "PENDING",                     // accepted, not applied yet
  PendingReference = "PENDING_REFERENCE",  // waiting for the referenced transaction
  Processed = "PROCESSED",                 // applied (terminal)
  Rejected = "REJECTED",                   // business rule violation (terminal)
  Failed = "FAILED",                       // permanent infrastructure error (terminal, auditable)
}

export { PROVIDER_KINDS, WagerTransactionKind, WagerTransactionStatus, type WalletOperationKind };
