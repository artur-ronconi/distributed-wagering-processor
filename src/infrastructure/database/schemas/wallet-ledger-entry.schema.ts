import { EntitySchema } from "@mikro-orm/core";

interface IWalletLedgerEntryRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: string;
  amount: string;
  balanceBeforeAmount: string;
  balanceAfterAmount: string;
  currency: string;
  createdAt: Date;
}

const WalletLedgerEntrySchema = new EntitySchema<IWalletLedgerEntryRow>({
  name: "WalletLedgerEntry",
  tableName: "wallet_ledger_entries",
  properties: {
    id: { type: "string", length: 16, primary: true },
    walletId: { type: "string", length: 16 },
    transactionId: { type: "string", length: 16 },
    direction: { type: "string" },
    amount: { type: "string", columnType: "numeric(19,2)" },
    balanceBeforeAmount: { type: "string", columnType: "numeric(19,2)" },
    balanceAfterAmount: { type: "string", columnType: "numeric(19,2)" },
    currency: { type: "string", length: 3 },
    createdAt: { type: "datetime" },
  },
});

export { WalletLedgerEntrySchema, IWalletLedgerEntryRow };
