import {
  DateValueObject,
  Entity,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { type IWalletLedgerEntryProps, LedgerDirection } from "./wallet-ledger-entry.props";
import { UNBALANCED_LEDGER_ENTRY } from "./wallet-ledger-entry.errors";

class WalletLedgerEntryEntity extends Entity<IWalletLedgerEntryProps> {
  private constructor(props: IWalletLedgerEntryProps) {
    super(props);
    this.props.createdAt = props.createdAt ?? DateValueObject.getDefault();
    Object.freeze(this.props); // structural immutability: no field can change after this line
  }

  get walletId() {
    return this.props.walletId;
  }

  get transactionId() {
    return this.props.transactionId;
  }

  get direction() {
    return this.props.direction;
  }

  get money() {
    return this.props.money;
  }

  get balanceBefore() {
    return this.props.balanceBefore;
  }

  get balanceAfter() {
    return this.props.balanceAfter;
  }

  get createdAt() {
    return this.props.createdAt as DateValueObject;
  }

  /** balanceBefore ± money === balanceAfter */
  isBalanced(): boolean {
    const { money, balanceBefore, balanceAfter, direction } = this.props;

    const sameCurrency =
      money.currency === balanceBefore.currency && money.currency === balanceAfter.currency;
    if (!sameCurrency) return false;

    const expected =
      direction === LedgerDirection.Credit ? balanceBefore.add(money) : balanceBefore.subtract(money);

    return expected.equals(balanceAfter);
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = [
      "walletId",
      "transactionId",
      "money",
      "balanceBefore",
      "balanceAfter",
      "createdAt",
      ...this.defaultValueObjects,
    ];
    const requiredProps = [...valueObjects, "direction"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);
    if (!allPropsExists || !areValueObjects) return false;

    const isKnownDirection = Object.values(LedgerDirection).includes(this.props.direction);

    return (
      isKnownDirection &&
      this.props.money.isPositive() &&
      !this.props.balanceAfter.isNegative() &&
      this.isBalanced()
    );
  }

  static create(props: IWalletLedgerEntryProps) {
    const entry = new WalletLedgerEntryEntity(props);

    const isInvalidProps = !entry.isValidProps();
    if (isInvalidProps) return Output.fail(UNBALANCED_LEDGER_ENTRY);

    return Output.success(entry);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IWalletLedgerEntryProps): WalletLedgerEntryEntity {
    return new WalletLedgerEntryEntity(props);
  }
}

export { WalletLedgerEntryEntity };
