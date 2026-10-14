import { InboxMessageSchema } from "./inbox-message.schema";
import { OutboxMessageSchema } from "./outbox-message.schema";
import { WagerTransactionSchema } from "./wager-transaction.schema";
import { WalletLedgerEntrySchema } from "./wallet-ledger-entry.schema";
import { WalletSchema } from "./wallet.schema";

const ENTITY_SCHEMAS = [
  WalletSchema,
  WalletLedgerEntrySchema,
  WagerTransactionSchema,
  InboxMessageSchema,
  OutboxMessageSchema,
];

export { ENTITY_SCHEMAS };
