import { type MoneyProps } from "../aggregate/value-objects/money/money.props";
import { LedgerDirection } from "../aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { WalletAggregate } from "../aggregate/aggregate-root/wallet.aggregate-root";
import { WalletLedgerEntryEntity } from "../aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { type EventContext, IntegrationEvent } from "../../../messaging/domain/events/integration-event";

interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  static from(wallet: WalletAggregate, entry: WalletLedgerEntryEntity, ctx: EventContext) {
    return new WalletBalanceChanged(
      IntegrationEvent.envelope(wallet.id.value, ctx, {
        walletId: wallet.id.value,
        transactionId: entry.transactionId.value,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      }),
    );
  }
}

export { WalletBalanceChanged, type WalletBalanceChangedData };
