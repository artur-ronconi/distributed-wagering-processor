import { EntitySchema } from "@mikro-orm/core";

interface IWalletRow {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string; // numeric(19,2) is read as a string: exact, never a JS number
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Column names become snake_case through MikroORM's default UnderscoreNamingStrategy.
// The canonical table definition (constraints, checks) lives in the migrations.
const WalletSchema = new EntitySchema<IWalletRow>({
  name: "Wallet",
  tableName: "wallets",
  properties: {
    id: { type: "string", length: 16, primary: true },
    playerId: { type: "string" },
    currency: { type: "string", length: 3 },
    balanceAmount: { type: "string", columnType: "numeric(19,2)" },
    version: { type: "integer" },
    createdAt: { type: "datetime" },
    updatedAt: { type: "datetime" },
  },
});

export { WalletSchema, type IWalletRow };
