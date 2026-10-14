import { type IUnidirectionalMapper } from "ddd-tool-kit";

import { type MoneyProps } from "../../domain/money/money.props";
import { WalletAggregate } from "../../domain/wallet/wallet.aggregate-root";

interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

class WalletViewMapper implements IUnidirectionalMapper<WalletAggregate, WalletView> {
  toRightSide(wallet: WalletAggregate): WalletView {
    return {
      id: wallet.id.value,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}

export { type WalletView, WalletViewMapper };
