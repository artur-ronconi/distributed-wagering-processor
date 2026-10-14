import { DateValueObject, type IBaseDomainEntity, IdValueObject } from "ddd-tool-kit";
import { MoneyValueObject } from "../../value-objects/money/money.value-object";

enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

interface IWalletLedgerEntryProps extends IBaseDomainEntity {
  walletId: IdValueObject;
  transactionId: IdValueObject;
  direction: LedgerDirection;
  money: MoneyValueObject;
  balanceBefore: MoneyValueObject;
  balanceAfter: MoneyValueObject;
  createdAt?: DateValueObject;
}

export { LedgerDirection, type IWalletLedgerEntryProps };
