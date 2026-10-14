import { forwardRef, Module } from "@nestjs/common";

import { MessagingModule } from "../messaging/messaging.module";
import { WalletModule } from "../wallet/wallet.module";
import { WAGER_TRANSACTION_REPOSITORY } from "./domain/services/wager-transaction.repository";
import { GetProviderWagerTransactionUseCase } from "./domain/usecases/get-provider-wager-transaction/get-provider-wager-transaction.usecase";
import { GetWagerTransactionUseCase } from "./domain/usecases/get-wager-transaction/get-wager-transaction.usecase";
import { WagerTransactionProcessor } from "./domain/usecases/process-wager-transaction/wager-transaction.processor";
import { ResolvePendingReferencesUseCase } from "./domain/usecases/resolve-pending-references/resolve-pending-references.usecase";
import { SubmitWagerTransactionUseCase } from "./domain/usecases/submit-wager-transaction/submit-wager-transaction.usecase";
import { MikroOrmWagerTransactionRepository } from "./infrastructure/database/repositories/mikro-orm.wager-transaction.repository";
import { PendingReferenceConsumer } from "./presentation/consumers/pending-reference.consumer";
import { WagerTransactionsConsumer } from "./presentation/consumers/wager-transactions.consumer";
import { GetProviderWagerTransactionController } from "./presentation/controllers/get-provider-wager-transaction.controller";
import { GetWagerTransactionController } from "./presentation/controllers/get-wager-transaction.controller";
import { SubmitWagerTransactionController } from "./presentation/controllers/submit-wager-transaction.controller";

/** BET/WIN/LOSS/REFUND/ROLLBACK: HTTP route, SQS consumer and pending-reference consumer share one processor. */
@Module({
  imports: [MessagingModule, forwardRef(() => WalletModule)],
  controllers: [SubmitWagerTransactionController, GetWagerTransactionController, GetProviderWagerTransactionController],
  providers: [
    { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroOrmWagerTransactionRepository },
    WagerTransactionProcessor,
    SubmitWagerTransactionUseCase,
    GetWagerTransactionUseCase,
    GetProviderWagerTransactionUseCase,
    ResolvePendingReferencesUseCase,
    WagerTransactionsConsumer,
    PendingReferenceConsumer,
  ],
  exports: [WAGER_TRANSACTION_REPOSITORY, WagerTransactionProcessor],
})
class WagerTransactionModule {}

export { WagerTransactionModule };
