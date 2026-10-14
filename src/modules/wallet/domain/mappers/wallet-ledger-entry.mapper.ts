import { type IBidirectionalMapper } from "ddd-tool-kit";

import { WalletLedgerEntryEntity } from "../aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity";
import { LedgerDirection } from "../aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { type IWalletLedgerEntryRow } from "../../infrastructure/database/schemas/wallet-ledger-entry.schema";
import { date, id, money } from "../../../../shared/domain/mapping.helpers";

class WalletLedgerEntryMapper implements IBidirectionalMapper<IWalletLedgerEntryRow, WalletLedgerEntryEntity> {
  toRightSide(row: IWalletLedgerEntryRow): WalletLedgerEntryEntity {
    return WalletLedgerEntryEntity.rehydrate({
      id: id(row.id),
      walletId: id(row.walletId),
      transactionId: id(row.transactionId),
      direction: row.direction as LedgerDirection,
      money: money(row.amount, row.currency),
      balanceBefore: money(row.balanceBeforeAmount, row.currency),
      balanceAfter: money(row.balanceAfterAmount, row.currency),
      createdAt: date(row.createdAt),
    });
  }

  toLeftSide(entry: WalletLedgerEntryEntity): IWalletLedgerEntryRow {
    return {
      id: entry.id.value,
      walletId: entry.walletId.value,
      transactionId: entry.transactionId.value,
      direction: entry.direction,
      amount: entry.money.toString(),
      balanceBeforeAmount: entry.balanceBefore.toString(),
      balanceAfterAmount: entry.balanceAfter.toString(),
      currency: entry.money.currency,
      createdAt: entry.createdAt.value,
    };
  }
}

export { WalletLedgerEntryMapper };
