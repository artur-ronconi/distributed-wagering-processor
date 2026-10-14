import { EntitySchema } from "@mikro-orm/core";

interface IWagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  status: string;
  referenceTransactionId: string | null;
  failureCode: string | null;
  observedBalanceAmount: string | null;
  processedAt: Date | null;
  referenceAttempts: number;
  nextReferenceAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WagerTransactionSchema = new EntitySchema<IWagerTransactionRow>({
  name: "WagerTransaction",
  tableName: "wager_transactions",
  properties: {
    id: { type: "string", length: 16, primary: true },
    providerId: { type: "string" },
    externalTransactionId: { type: "string" },
    idempotencyKey: { type: "string" },
    payloadHash: { type: "string", length: 64 },
    walletId: { type: "string", length: 16 },
    playerId: { type: "string" },
    roundId: { type: "string" },
    gameId: { type: "string" },
    kind: { type: "string" },
    amount: { type: "string", columnType: "numeric(19,2)" },
    currency: { type: "string", length: 3 },
    referenceExternalTransactionId: { type: "string", nullable: true },
    status: { type: "string" },
    referenceTransactionId: { type: "string", length: 16, nullable: true },
    failureCode: { type: "string", nullable: true },
    observedBalanceAmount: { type: "string", columnType: "numeric(19,2)", nullable: true },
    processedAt: { type: "datetime", nullable: true },
    referenceAttempts: { type: "integer" },
    nextReferenceAttemptAt: { type: "datetime", nullable: true },
    createdAt: { type: "datetime" },
    updatedAt: { type: "datetime" },
  },
});

export { WagerTransactionSchema, type IWagerTransactionRow };
