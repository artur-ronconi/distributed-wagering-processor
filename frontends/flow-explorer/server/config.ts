import { resolve } from "node:path";

/** Everything the visualizer talks to. Defaults match `docker compose up` of the backend. */
const config = {
  port: Number(process.env.FLOW_UI_PORT ?? 4000),
  apiUrl: process.env.FLOW_API_URL ?? "http://localhost:3000",
  databaseUrl:
    process.env.FLOW_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://wagering:wagering@localhost:5433/wagering",
  aws: {
    endpoint: process.env.FLOW_AWS_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
    region: process.env.AWS_REGION ?? "us-east-1",
  },
  queues: {
    wager: process.env.WAGER_QUEUE_NAME ?? "wager-transactions.fifo",
    dlq: process.env.WAGER_DLQ_NAME ?? "wager-transactions-dlq.fifo",
    events: process.env.EVENTS_QUEUE_NAME ?? "wagering-events.fifo",
  },
  /** The visualizer acts as the downstream consumer of the events queue (receives and deletes). */
  drainEvents: (process.env.FLOW_DRAIN_EVENTS ?? "true") !== "false",
  repoRoot: resolve(import.meta.dir, "../../.."),
};

export { config };
