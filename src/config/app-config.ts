const APP_CONFIG = Symbol("APP_CONFIG");

interface AppConfig {
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  /** Max time a transaction waits for a wallet row lock before failing as transient. */
  lockTimeoutMs: number;
  migrationsRunOnBoot: boolean;
  logLevel: string;
  aws: {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  queues: {
    wagerTransactions: string;
    wagerTransactionsDlq: string;
    events: string;
  };
  run: {
    http: boolean;
    sqsConsumer: boolean;
    outboxPublisher: boolean;
    pendingReferenceWorker: boolean;
  };
  sqsConsumer: {
    maxMessages: number;
    waitTimeSeconds: number;
    visibilityTimeoutSeconds: number;
    maxReceiveCount: number;
  };
  outboxPublisher: {
    intervalMs: number;
    batchSize: number;
  };
  pendingReference: {
    intervalMs: number;
    batchSize: number;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : ["1", "true", "yes"].includes(value.toLowerCase());

const int = (value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => ({
  port: int(env.PORT, 3000),
  databaseUrl: env.DATABASE_URL ?? "postgres://wagering:wagering@localhost:5433/wagering",
  databasePoolMax: int(env.DATABASE_POOL_MAX, 20),
  lockTimeoutMs: int(env.LOCK_TIMEOUT_MS, 5_000),
  migrationsRunOnBoot: bool(env.MIGRATIONS_RUN_ON_BOOT, true),
  logLevel: env.LOG_LEVEL ?? "info",
  aws: {
    region: env.AWS_REGION ?? "us-east-1",
    endpoint: env.AWS_ENDPOINT_URL,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  queues: {
    wagerTransactions: env.WAGER_QUEUE_NAME ?? "wager-transactions.fifo",
    wagerTransactionsDlq: env.WAGER_DLQ_NAME ?? "wager-transactions-dlq.fifo",
    events: env.EVENTS_QUEUE_NAME ?? "wagering-events.fifo",
  },
  run: {
    http: bool(env.RUN_HTTP, true),
    sqsConsumer: bool(env.RUN_SQS_CONSUMER, true),
    outboxPublisher: bool(env.RUN_OUTBOX_PUBLISHER, true),
    pendingReferenceWorker: bool(env.RUN_PENDING_REFERENCE_WORKER, true),
  },
  sqsConsumer: {
    maxMessages: int(env.SQS_CONSUMER_MAX_MESSAGES, 10),
    waitTimeSeconds: int(env.SQS_CONSUMER_WAIT_SECONDS, 5),
    visibilityTimeoutSeconds: int(env.SQS_VISIBILITY_TIMEOUT_SECONDS, 30),
    maxReceiveCount: int(env.SQS_MAX_RECEIVE_COUNT, 5),
  },
  outboxPublisher: {
    intervalMs: int(env.OUTBOX_INTERVAL_MS, 500),
    batchSize: int(env.OUTBOX_BATCH_SIZE, 50),
  },
  pendingReference: {
    intervalMs: int(env.PENDING_REFERENCE_INTERVAL_MS, 1_000),
    batchSize: int(env.PENDING_REFERENCE_BATCH_SIZE, 50),
    maxAttempts: int(env.PENDING_REFERENCE_MAX_ATTEMPTS, 10),
    baseDelayMs: int(env.PENDING_REFERENCE_BASE_DELAY_MS, 1_000),
    maxDelayMs: int(env.PENDING_REFERENCE_MAX_DELAY_MS, 60_000),
  },
});

export { APP_CONFIG, type AppConfig, loadConfig };
