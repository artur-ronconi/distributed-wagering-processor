import { type DynamicModule, Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";

import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { MikroOrmUnitOfWork } from "./infrastructure/database/mikro-orm.unit-of-work";
import { DependencyChecks } from "./infrastructure/services/dependency-checks";
import { PrometheusMetrics } from "./infrastructure/services/prometheus.metrics";
import { ShutdownState } from "./infrastructure/services/shutdown-state";
import { createSqsClient, SQS_CLIENT } from "./infrastructure/services/sqs.client";
import { HealthController } from "./presentation/controllers/health.controller";
import { MetricsController } from "./presentation/controllers/metrics.controller";
import { AllExceptionsFilter } from "./presentation/http/all-exceptions.filter";
import { AuthGuard } from "./presentation/http/auth.guard";
import { HttpMetricsInterceptor } from "./presentation/http/http-metrics.interceptor";
import { createValidationPipe } from "./presentation/http/validation.pipe";
import { METRICS } from "./services/metrics.service";
import { UNIT_OF_WORK } from "./services/unit-of-work.service";

/** Shared kernel available to every module: config, transactions, SQS client, metrics, health and HTTP concerns. */
@Global()
@Module({})
class SharedModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: SharedModule,
      global: true,
      controllers: [HealthController, MetricsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
        { provide: SQS_CLIENT, useFactory: () => createSqsClient(config) },
        PrometheusMetrics,
        { provide: METRICS, useExisting: PrometheusMetrics },
        DependencyChecks,
        ShutdownState,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
      exports: [APP_CONFIG, UNIT_OF_WORK, SQS_CLIENT, PrometheusMetrics, METRICS, ShutdownState],
    };
  }
}

export { SharedModule };
