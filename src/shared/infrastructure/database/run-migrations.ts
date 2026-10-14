import { MikroORM } from "@mikro-orm/postgresql";

// Arbitrary constant: all instances agree on it.
const MIGRATION_LOCK_KEY = 4_242_042_042;

/**
 * Applies pending migrations at boot. Several instances may start together: a transaction-scoped
 * advisory lock makes them run one after the other, so only the first actually migrates.
 */
const runMigrations = async (orm: MikroORM): Promise<string[]> => {
  const knex = orm.em.getKnex();
  return knex.transaction(async (trx) => {
    await trx.raw("select pg_advisory_xact_lock(?)", [MIGRATION_LOCK_KEY]);
    const applied = await orm.getMigrator().up();
    return applied.map((migration) => migration.name);
  });
};

export { runMigrations };
