import type { Subprocess } from "bun";

import { TEST_DATABASE_URL } from "./database";
import { TEST_QUEUES } from "./app";

export interface Instance {
  url: string;
  process: Subprocess;
  kill(signal?: NodeJS.Signals): Promise<void>;
}

/** Starts a real, separate OS process of the service (bun src/main.ts) against the test database and queues. */
export const startInstance = async (port: number, env: Record<string, string> = {}): Promise<Instance> => {
  const child = Bun.spawn(["bun", "src/main.ts"], {
    cwd: `${import.meta.dir}/../..`,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_POOL_MAX: "10",
      AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      WAGER_QUEUE_NAME: TEST_QUEUES.wagerTransactions,
      WAGER_DLQ_NAME: TEST_QUEUES.wagerTransactionsDlq,
      EVENTS_QUEUE_NAME: TEST_QUEUES.events,
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
      SQS_CONSUMER_WAIT_SECONDS: "1",
      OUTBOX_INTERVAL_MS: "100",
      PENDING_REFERENCE_INTERVAL_MS: "200",
      PENDING_REFERENCE_BASE_DELAY_MS: "200",
      ...env,
    },
    stdout: process.env.TEST_LOG_LEVEL ? "inherit" : "ignore",
    stderr: "inherit",
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health/ready`)).status === 200) break;
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) throw new Error(`instance on port ${port} exited with ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error(`instance on port ${port} not ready`);
    await Bun.sleep(200);
  }

  return {
    url,
    process: child,
    kill: async (signal: NodeJS.Signals = "SIGTERM") => {
      if (child.exitCode !== null) return;
      child.kill(signal);
      await child.exited;
    },
  };
};
