/**
 * Makes a test command self-sufficient: `bun test/support/ensure-infra.ts <infra|app>`.
 *
 *  - infra: PostgreSQL + LocalStack (integration and concurrency tests);
 *  - app:   the whole stack, including the app container (load test).
 *
 * Every needed service that is already healthy is left alone; only what is missing is started
 * (`docker compose up -d <services> --wait`). Nothing is ever stopped: the stack stays up afterwards.
 */
import { $ } from "bun";

const SERVICES = { infra: ["postgres", "localstack"], app: ["postgres", "localstack", "app"] } as const;
const target = (process.argv[2] ?? "infra") as keyof typeof SERVICES;
const services = SERVICES[target];
if (!services) {
  console.error(`usage: ensure-infra.ts <${Object.keys(SERVICES).join("|")}>`);
  process.exit(2);
}

const log = (message: string) => console.log(`[infra] ${message}`);

const healthy = async (): Promise<Set<string>> => {
  const output = await $`docker compose ps --format json`.nothrow().quiet().text();
  const rows = output
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as { Service: string; State: string; Health: string });
  return new Set(rows.filter((r) => r.State === "running" && r.Health === "healthy").map((r) => r.Service));
};

const docker = await $`docker info`.nothrow().quiet();
if (docker.exitCode !== 0) {
  console.error("[infra] Docker is not running or not installed. Start Docker and run the command again.");
  process.exit(1);
}

const up = await healthy();
const missing = services.filter((service) => !up.has(service));

if (missing.length === 0) {
  log(`${services.join(", ")} already running: leaving as is`);
} else {
  log(`starting ${missing.join(", ")} (already healthy: ${[...up].join(", ") || "none"})...`);
  const started = await $`docker compose up -d ${missing} --wait`.nothrow();
  if (started.exitCode !== 0) {
    console.error("[infra] could not start the services (see the output above).");
    process.exit(1);
  }
}

// docker/postgres/init.sql only runs when the volume is created: an older volume may lack the test database.
const exists = await $`docker compose exec -T postgres psql -U wagering -d postgres -tAc ${"select 1 from pg_database where datname = 'wagering_test'"}`
  .nothrow()
  .quiet()
  .text();
if (exists.trim() !== "1") {
  log("creating the wagering_test database (the volume predates it)...");
  const created = await $`docker compose exec -T postgres psql -U wagering -d postgres -c ${"create database wagering_test owner wagering"}`
    .nothrow()
    .quiet();
  if (created.exitCode !== 0) {
    console.error("[infra] could not create wagering_test.");
    process.exit(1);
  }
}

log("ready");
