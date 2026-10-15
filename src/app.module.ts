import { MikroOrmModule } from "@mikro-orm/nestjs";
import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { type AppConfig } from "./config/app-config";
import { createMikroOrmConfig } from "./config/mikro-orm.config";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { WagerTransactionModule } from "./modules/wager-transaction/wager-transaction.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { correlationIdFor } from "./shared/presentation/http/correlation-id";
import { SharedModule } from "./shared/shared.module";

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
        SharedModule.forRoot(config),
        WalletModule,
        WagerTransactionModule,
        MessagingModule,
      ],
    };
  }
}

export { AppModule };
