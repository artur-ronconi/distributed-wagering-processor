import { WagerTransactionKind, WagerTransactionStatus } from "../../../domain/wager-transaction/wager-transaction.enums";

const transactionExamples = {
  processed: {
    summary: "PROCESSED BET",
    value: {
      transactionId: "9a7e0c3d51b2f846",
      providerId: "provider-a",
      externalTransactionId: "transaction-123",
      walletId: "4f1c2a9be07d3e58",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: null,
      referenceTransactionId: null,
      status: WagerTransactionStatus.Processed,
      failureCode: null,
      balance: { amount: "975.00", currency: "BRL" },
      processedAt: "2026-07-29T15:00:00.120Z",
      createdAt: "2026-07-29T15:00:00.100Z",
    },
  },
  pendingReference: {
    summary: "ROLLBACK waiting for its BET",
    value: {
      transactionId: "5d2c1b0a9f8e7d6c",
      providerId: "provider-a",
      externalTransactionId: "transaction-456",
      walletId: "4f1c2a9be07d3e58",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: "transaction-123",
      referenceTransactionId: null,
      status: WagerTransactionStatus.PendingReference,
      failureCode: null,
      balance: null,
      processedAt: null,
      createdAt: "2026-07-29T14:59:59.000Z",
    },
  },
};

export { transactionExamples };
