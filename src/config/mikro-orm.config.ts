import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";

import { type AppConfig } from "./app-config";
import { Migration20261014120000InitialSchema } from "../shared/infrastructure/database/migrations/Migration20261014120000InitialSchema";
import { Migration20261015120000WalletOperations } from "../shared/infrastructure/database/migrations/Migration20261015120000WalletOperations";
import { ENTITY_SCHEMAS } from "./entity-schemas";

const createMikroOrmConfig = (config: Pick<AppConfig, "databaseUrl" | "databasePoolMax">): Options =>
  defineConfig({
    clientUrl: config.databaseUrl,
    entities: ENTITY_SCHEMAS,
    extensions: [Migrator],
    // Only an explicit RequestContext or transaction may touch the EntityManager.
    allowGlobalContext: false,
    pool: { min: 1, max: config.databasePoolMax },
    discovery: { warnWhenNoEntities: true },
    migrations: {
      tableName: "mikro_orm_migrations",
      transactional: true,
      allOrNothing: true,
      // Explicit list: works the same when running TypeScript directly on Bun and inside Docker.
      migrationsList: [
        { name: "Migration20261014120000InitialSchema", class: Migration20261014120000InitialSchema },
        { name: "Migration20261015120000WalletOperations", class: Migration20261015120000WalletOperations },
      ],
    },
    debug: false,
  });

export { createMikroOrmConfig };
