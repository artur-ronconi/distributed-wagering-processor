import { forwardRef, Module } from "@nestjs/common";

import { MessagingModule } from "../messaging/messaging.module";
import { WagerTransactionModule } from "../wager-transaction/wager-transaction.module";
import { LEDGER_RECONCILIATION_QUERY } from "./domain/interfaces/ledger-reconciliation.query";
import { WALLET_LEDGER_QUERY } from "./domain/interfaces/wallet-ledger.query";
import { WALLET_REPOSITORY } from "./domain/interfaces/wallet.repository";
import { CreateWalletUseCase } from "./domain/usecases/create-wallet/create-wallet.usecase";
import { GetWalletLedgerUseCase } from "./domain/usecases/get-wallet-ledger/get-wallet-ledger.usecase";
import { GetWalletUseCase } from "./domain/usecases/get-wallet/get-wallet.usecase";
import { ReconcileWalletUseCase } from "./domain/usecases/reconcile-wallet/reconcile-wallet.usecase";
import { MikroOrmLedgerReconciliationQuery } from "./infrastructure/database/queries/mikro-orm.ledger-reconciliation.query";
import { MikroOrmWalletLedgerQuery } from "./infrastructure/database/queries/mikro-orm.wallet-ledger.query";
import { MikroOrmWalletRepository } from "./infrastructure/database/repositories/mikro-orm.wallet.repository";
import { CreateWalletController } from "./presentation/controllers/create-wallet.controller";
import { GetWalletLedgerController } from "./presentation/controllers/get-wallet-ledger.controller";
import { GetWalletController } from "./presentation/controllers/get-wallet.controller";
import { ReconcileWalletController } from "./presentation/controllers/reconcile-wallet.controller";

/**
 * Wallets, their ledger and money. Creating a wallet with a balance also creates the internal OPENING
 * wager transaction, hence the (forwardRef) dependency on the wager-transaction module.
 */
@Module({
  imports: [MessagingModule, forwardRef(() => WagerTransactionModule)],
  controllers: [CreateWalletController, GetWalletController, GetWalletLedgerController, ReconcileWalletController],
  providers: [
    { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
    { provide: WALLET_LEDGER_QUERY, useClass: MikroOrmWalletLedgerQuery },
    { provide: LEDGER_RECONCILIATION_QUERY, useClass: MikroOrmLedgerReconciliationQuery },
    CreateWalletUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
  ],
  exports: [WALLET_REPOSITORY],
})
class WalletModule {}

export { WalletModule };
