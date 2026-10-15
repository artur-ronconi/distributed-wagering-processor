import { InboxMessageSchema } from "../modules/messaging/infrastructure/database/schemas/inbox-message.schema";
import { OutboxMessageSchema } from "../modules/messaging/infrastructure/database/schemas/outbox-message.schema";
import { WagerTransactionSchema } from "../modules/wager-transaction/infrastructure/database/schemas/wager-transaction.schema";
import { WalletLedgerEntrySchema } from "../modules/wallet/infrastructure/database/schemas/wallet-ledger-entry.schema";
import { WalletSchema } from "../modules/wallet/infrastructure/database/schemas/wallet.schema";

const ENTITY_SCHEMAS = [
  WalletSchema,
  WalletLedgerEntrySchema,
  WagerTransactionSchema,
  InboxMessageSchema,
  OutboxMessageSchema,
];

export { ENTITY_SCHEMAS };
