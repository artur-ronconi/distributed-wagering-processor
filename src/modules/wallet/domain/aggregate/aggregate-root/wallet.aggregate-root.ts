import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  throwFailOutput,
  verifyAllPropsExists,
  verifyAreEntities,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { type IDomainError } from "../../../../../shared/domain/domain-error";
import { MoneyValueObject } from "../value-objects/money/money.value-object";
import { LedgerDirection } from "../entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletLedgerEntryEntity } from "../entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { type IOpenWalletProps, type IRehydrateWalletProps, type IWalletProps } from "./wallet.props";
import {
  INSUFFICIENT_FUNDS,
  INVALID_MOVEMENT_AMOUNT,
  INVALID_WALLET,
  WALLET_CURRENCY_MISMATCH,
} from "./wallet.errors";

class WalletAggregate extends Aggregate<IWalletProps> {
  private constructor(props: IWalletProps) {
    super(props);
  }

  get playerId() {
    return this.props.playerId;
  }

  get currency() {
    return this.props.currency;
  }

  get balance() {
    return this.props.balance;
  }

  get version() {
    return this.props.version;
  }

  /** Entries created in this unit of work and not saved yet. */
  get newLedgerEntries(): readonly WalletLedgerEntryEntity[] {
    return this.props.newLedgerEntries;
  }

  /** Called by WalletRepository.save: returns the new entries and empties the list. */
  pullNewLedgerEntries(): WalletLedgerEntryEntity[] {
    const entries = this.props.newLedgerEntries;
    this.props.newLedgerEntries = [];
    return entries;
  }

  /**
   * Debits the wallet and adds the ledger entry that records it to the aggregate.
   * Returns the entry so the use case can build WalletBalanceChanged.
   * `insufficientFundsError` lets a ROLLBACK report REVERSAL_WOULD_OVERDRAW instead of INSUFFICIENT_FUNDS.
   */
  debit(
    money: MoneyValueObject,
    transactionId: IdValueObject,
    insufficientFundsError: IDomainError = INSUFFICIENT_FUNDS,
  ) {
    const invalidMovement = this.validateMovement(money);
    if (invalidMovement) return Output.fail(invalidMovement);

    if (this.props.balance.isLessThan(money)) return Output.fail(insufficientFundsError);

    return this.apply(LedgerDirection.Debit, money, transactionId);
  }

  /** Credits the wallet and adds the ledger entry that records it to the aggregate. */
  credit(money: MoneyValueObject, transactionId: IdValueObject) {
    const invalidMovement = this.validateMovement(money);
    if (invalidMovement) return Output.fail(invalidMovement);

    return this.apply(LedgerDirection.Credit, money, transactionId);
  }

  private validateMovement(money: MoneyValueObject): IDomainError | null {
    if (money.currency !== this.props.currency) return WALLET_CURRENCY_MISMATCH;
    if (!money.isPositive()) return INVALID_MOVEMENT_AMOUNT;
    return null;
  }

  /** Builds the entry first; the wallet only changes if the entry is valid. */
  private apply(direction: LedgerDirection, money: MoneyValueObject, transactionId: IdValueObject) {
    const balanceBefore = this.props.balance;
    const balanceAfter =
      direction === LedgerDirection.Debit ? balanceBefore.subtract(money) : balanceBefore.add(money);

    const createEntry = WalletLedgerEntryEntity.create({
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
    });
    if (createEntry.isFailure) return throwFailOutput(createEntry);

    const entry = createEntry.result as WalletLedgerEntryEntity;

    this.props.balance = balanceAfter;
    this.props.version += 1;
    this.props.updatedAt = DateValueObject.getDefault();
    this.props.newLedgerEntries.push(entry);

    return Output.success(entry);
  }

  protected sanitizeProps(): void {
    this.props.playerId = this.props.playerId?.trim();
  }

  protected isValidProps(): boolean {
    const valueObjects = ["balance", ...this.defaultValueObjects];
    const entities = ["newLedgerEntries"];
    const requiredProps = [...valueObjects, ...entities, "playerId", "currency", "version"];

    const allPropsExists = verifyAllPropsExists(requiredProps, this);
    const areValueObjects = verifyAreValueObjects(valueObjects, this);
    const areEntities = verifyAreEntities(entities, this);
    if (!allPropsExists || !areValueObjects || !areEntities) return false;

    return (
      this.props.balance.currency === this.props.currency &&
      !this.props.balance.isNegative() &&
      Number.isInteger(this.props.version) &&
      this.props.version >= 1
    );
  }

  /** OLD_README `Wallet.open`: version 1, plus the OPENING ledger entry when the initial balance > 0. */
  static open(props: IOpenWalletProps) {
    const { initialBalance } = props;

    const wallet = new WalletAggregate({
      id: props.id,
      playerId: props.playerId,
      currency: initialBalance.currency,
      balance: initialBalance,
      version: 1,
      newLedgerEntries: [],
    });

    const isInvalidProps = !wallet.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_WALLET);

    if (initialBalance.isZero()) return Output.success(wallet);

    const createEntry = WalletLedgerEntryEntity.create({
      walletId: wallet.id,
      transactionId: props.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: MoneyValueObject.zero(initialBalance.currency),
      balanceAfter: initialBalance,
    });
    if (createEntry.isFailure) return throwFailOutput(createEntry);

    wallet.props.newLedgerEntries.push(createEntry.result as WalletLedgerEntryEntity);

    return Output.success(wallet);
  }

  /** Rebuilds persisted state. Does not revalidate. History is never loaded. */
  static rehydrate(props: IRehydrateWalletProps): WalletAggregate {
    return new WalletAggregate({ ...props, newLedgerEntries: [] });
  }
}

export { WalletAggregate };
