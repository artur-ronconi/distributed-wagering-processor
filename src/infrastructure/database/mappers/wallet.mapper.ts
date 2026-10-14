import { IBidirectionalMapper } from "ddd-tool-kit";

import { WalletAggregate } from "../../../domain/wallet/wallet.aggregate-root";
import { IWalletRow } from "../schemas/wallet.schema";
import { date, id, money } from "./mapping.helpers";

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
