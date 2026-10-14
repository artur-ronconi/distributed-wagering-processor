import { MikroOrmModule } from "@mikro-orm/nestjs";
import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "./config/app-config";
import { EVENT_PUBLISHER } from "./application/ports/event-publisher.port";
import { INBOX_MESSAGE_REPOSITORY } from "./application/ports/inbox-message.repository";
import { LEDGER_RECONCILIATION_QUERY } from "./application/ports/ledger-reconciliation.query";
import { METRICS } from "./application/ports/metrics.port";
import { OUTBOX_MESSAGE_REPOSITORY } from "./application/ports/outbox-message.repository";
import { UNIT_OF_WORK } from "./application/ports/unit-of-work.port";
import { WAGER_TRANSACTION_REPOSITORY } from "./application/ports/wager-transaction.repository";
import { WALLET_LEDGER_QUERY } from "./application/ports/wallet-ledger.query";
import { WALLET_REPOSITORY } from "./application/ports/wallet.repository";
import { WagerTransactionProcessor } from "./application/services/wager-transaction.processor";
import { CreateWalletService } from "./application/use-cases/create-wallet/create-wallet.service";
import { GetProviderWagerTransactionService } from "./application/use-cases/get-provider-wager-transaction/get-provider-wager-transaction.service";
import { GetWagerTransactionService } from "./application/use-cases/get-wager-transaction/get-wager-transaction.service";
import { GetWalletLedgerService } from "./application/use-cases/get-wallet-ledger/get-wallet-ledger.service";
import { GetWalletService } from "./application/use-cases/get-wallet/get-wallet.service";
import { PublishOutboxService } from "./application/use-cases/publish-outbox/publish-outbox.service";
import { ReconcileWalletService } from "./application/use-cases/reconcile-wallet/reconcile-wallet.service";
import { ResolvePendingReferencesService } from "./application/use-cases/resolve-pending-references/resolve-pending-references.service";
import { SubmitWagerTransactionService } from "./application/use-cases/submit-wager-transaction/submit-wager-transaction.service";
import { createMikroOrmConfig } from "./infrastructure/database/mikro-orm.config";
import { MikroOrmUnitOfWork } from "./infrastructure/database/mikro-orm.unit-of-work";
import { MikroOrmLedgerReconciliationQuery } from "./infrastructure/database/queries/mikro-orm.ledger-reconciliation.query";
import { MikroOrmWalletLedgerQuery } from "./infrastructure/database/queries/mikro-orm.wallet-ledger.query";
import { MikroOrmInboxMessageRepository } from "./infrastructure/database/repositories/mikro-orm.inbox-message.repository";
import { MikroOrmOutboxMessageRepository } from "./infrastructure/database/repositories/mikro-orm.outbox-message.repository";
import { MikroOrmWagerTransactionRepository } from "./infrastructure/database/repositories/mikro-orm.wager-transaction.repository";
import { MikroOrmWalletRepository } from "./infrastructure/database/repositories/mikro-orm.wallet.repository";
import { DependencyChecks } from "./infrastructure/health/dependency-checks";
import { ShutdownState } from "./infrastructure/health/shutdown-state";
import { SqsEventPublisher } from "./infrastructure/messaging/sqs-event.publisher";
import { createSqsClient, SQS_CLIENT } from "./infrastructure/messaging/sqs.client";
import { PrometheusMetrics } from "./infrastructure/observability/prometheus.metrics";
import { AllExceptionsFilter } from "./presentation/http/common/all-exceptions.filter";
import { AuthGuard } from "./presentation/http/common/auth.guard";
import { correlationIdFor } from "./presentation/http/common/correlation-id";
import { HttpMetricsInterceptor } from "./presentation/http/common/http-metrics.interceptor";
import { createValidationPipe } from "./presentation/http/common/validation.pipe";
import { HealthController } from "./presentation/http/health/health.controller";
import { MetricsController } from "./presentation/http/metrics/metrics.controller";
import { GetProviderWagerTransactionController } from "./presentation/http/providers/get-provider-wager-transaction.controller";
import { GetWagerTransactionController } from "./presentation/http/wagering/get-wager-transaction.controller";
import { SubmitWagerTransactionController } from "./presentation/http/wagering/submit-wager-transaction.controller";
import { CreateWalletController } from "./presentation/http/wallets/create-wallet.controller";
import { GetWalletLedgerController } from "./presentation/http/wallets/get-wallet-ledger.controller";
import { GetWalletController } from "./presentation/http/wallets/get-wallet.controller";
import { ReconcileWalletController } from "./presentation/http/wallets/reconcile-wallet.controller";
import { WagerTransactionsConsumer } from "./presentation/sqs/wager-transactions.consumer";
import { OutboxPublisherWorker } from "./presentation/workers/outbox-publisher.worker";
import { PendingReferenceWorker } from "./presentation/workers/pending-reference.worker";

@Module({})
class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            genReqId: correlationIdFor,
            customProps: (req) => ({ correlationId: (req as { id?: unknown }).id }),
            // never log bodies (financial payloads) nor credentials
            serializers: {
              req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            redact: ["req.headers.authorization"],
            autoLogging: { ignore: (req) => /^\/(health|metrics)/.test(req.url ?? "") },
          },
        }),
        MikroOrmModule.forRoot(createMikroOrmConfig(config)),
      ],
      controllers: [
        CreateWalletController,
        GetWalletController,
        GetWalletLedgerController,
        ReconcileWalletController,
        SubmitWagerTransactionController,
        GetWagerTransactionController,
        GetProviderWagerTransactionController,
        HealthController,
        MetricsController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        // ports → adapters
        { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
        { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
        { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroOrmWagerTransactionRepository },
        { provide: INBOX_MESSAGE_REPOSITORY, useClass: MikroOrmInboxMessageRepository },
        { provide: OUTBOX_MESSAGE_REPOSITORY, useClass: MikroOrmOutboxMessageRepository },
        { provide: WALLET_LEDGER_QUERY, useClass: MikroOrmWalletLedgerQuery },
        { provide: LEDGER_RECONCILIATION_QUERY, useClass: MikroOrmLedgerReconciliationQuery },
        { provide: SQS_CLIENT, useFactory: () => createSqsClient(config) },
        { provide: EVENT_PUBLISHER, useClass: SqsEventPublisher },
        PrometheusMetrics,
        { provide: METRICS, useExisting: PrometheusMetrics },
        // application
        WagerTransactionProcessor,
        CreateWalletService,
        GetWalletService,
        GetWalletLedgerService,
        ReconcileWalletService,
        SubmitWagerTransactionService,
        GetWagerTransactionService,
        GetProviderWagerTransactionService,
        ResolvePendingReferencesService,
        PublishOutboxService,
        // entry points other than HTTP
        WagerTransactionsConsumer,
        OutboxPublisherWorker,
        PendingReferenceWorker,
        // health
        DependencyChecks,
        ShutdownState,
        // cross-cutting HTTP concerns
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }
}

export { AppModule };
