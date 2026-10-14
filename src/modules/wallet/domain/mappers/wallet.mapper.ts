import { type IBidirectionalMapper } from "ddd-tool-kit";

import { WalletAggregate } from "../aggregate/aggregate-root/wallet.aggregate-root";
import { type IWalletRow } from "../../infrastructure/database/schemas/wallet.schema";
import { date, id, money } from "../../../../shared/domain/mapping.helpers";

class WalletMapper implements IBidirectionalMapper<IWalletRow, WalletAggregate> {
  toRightSide(row: IWalletRow): WalletAggregate {
    return WalletAggregate.rehydrate({
      id: id(row.id),
      playerId: row.playerId,
      currency: row.currency.trim(),
      balance: money(row.balanceAmount, row.currency),
      version: row.version,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
  }

  toLeftSide(wallet: WalletAggregate): IWalletRow {
    return {
      id: wallet.id.value,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balanceAmount: wallet.balance.toString(),
      version: wallet.version,
      createdAt: wallet.createdAt.value,
      updatedAt: wallet.updatedAt.value,
    };
  }
}

export { WalletMapper };
