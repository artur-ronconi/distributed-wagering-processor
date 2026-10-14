import { type IBaseDomainAggregate, IdValueObject } from "ddd-tool-kit";

import { MoneyValueObject } from "../money/money.value-object";
import { WalletLedgerEntryEntity } from "../wallet-ledger-entry/wallet-ledger-entry.entity";

interface IWalletProps extends IBaseDomainAggregate {
  playerId: string;
  currency: string;
  balance: MoneyValueObject;
  version: number;
  /** Only the entries created in this unit of work. History is never loaded. */
  newLedgerEntries: WalletLedgerEntryEntity[];
}

/** What the mapper provides: the persisted state, without in-memory entries. */
type IRehydrateWalletProps = Omit<IWalletProps, "newLedgerEntries">;

interface IOpenWalletProps {
  id?: IdValueObject;
  playerId: string;
  initialBalance: MoneyValueObject;
  /** Id of the internal OPENING WagerTransaction created by the use case. */
  openingTransactionId: IdValueObject;
}

export { type IWalletProps, type IRehydrateWalletProps, type IOpenWalletProps };
