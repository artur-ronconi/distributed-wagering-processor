import { MikroORM } from "@mikro-orm/postgresql";

import { loadConfig } from "../../../config/app-config";
import { createMikroOrmConfig } from "../../../config/mikro-orm.config";

/** bun run migration:up | migration:down — down reverts one migration at a time. */
const main = async (): Promise<void> => {
  const direction = process.argv[2];
  if (direction !== "up" && direction !== "down") {
    console.error("usage: migration.cli.ts up|down");
    process.exit(1);
  }

  const orm = await MikroORM.init(createMikroOrmConfig(loadConfig()));
  try {
    const migrator = orm.getMigrator();
    const result = direction === "up" ? await migrator.up() : await migrator.down();
    console.log(`${direction}: ${result.map((m) => m.name).join(", ") || "nothing to run"}`);
  } finally {
    await orm.close(true);
  }
};

void main();
