import "reflect-metadata";

import { MikroORM } from "@mikro-orm/postgresql";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { type AppConfig } from "./config/app-config";
import { runMigrations } from "./infrastructure/database/run-migrations";
import { setupSwagger } from "./presentation/http/swagger/swagger.setup";

/** Builds the application without listening (used by main.ts and by the integration tests). */
const createApp = async (config: AppConfig): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  if (config.migrationsRunOnBoot) {
    const applied = await runMigrations(app.get(MikroORM));
    app.get(Logger).log({ applied }, "migrations up to date");
  }

  setupSwagger(app);
  return app;
};

export { createApp };
