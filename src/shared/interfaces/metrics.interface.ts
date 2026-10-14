const METRICS = Symbol("METRICS");

type DuplicateSource = "inbox" | "idempotency_key";
type RetrySource = "sqs_message" | "outbox_publish" | "pending_reference" | "concurrency";

/** Application-level metrics. Implemented with prom-client in infrastructure. */
interface Metrics {
  transactionDecided(status: string, kind: string): void;
  duplicateDetected(source: DuplicateSource): void;
  retry(source: RetrySource): void;
  sentToDlq(reason: string): void;
  lockConflict(): void;
  reconciliationMismatch(currency: string): void;
  observeProcessing(source: "http" | "sqs" | "pending_reference", seconds: number): void;
  eventsPublished(count: number): void;
}

export { METRICS, type Metrics, type DuplicateSource, type RetrySource };
