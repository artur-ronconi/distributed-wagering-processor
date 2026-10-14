import { MikroORM } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

import { type DuplicateSource, type Metrics, type RetrySource } from "../../services/metrics.service";

/** prom-client implementation of the application Metrics port, exposed at GET /metrics. */
@Injectable()
class PrometheusMetrics implements Metrics {
  readonly registry = new Registry();

  private readonly transactions = new Counter({
    name: "wagering_transactions_total",
    help: "Wager transactions decided, by final status and kind",
    labelNames: ["status", "kind"],
    registers: [this.registry],
  });

  private readonly duplicates = new Counter({
    name: "wagering_duplicates_total",
    help: "Duplicates detected: inbox (SQS redelivery) or idempotency_key (provider replay)",
    labelNames: ["source"],
    registers: [this.registry],
  });

  private readonly retries = new Counter({
    name: "wagering_retries_total",
    help: "Retries by source",
    labelNames: ["source"],
    registers: [this.registry],
  });

  private readonly dlq = new Counter({
    name: "wagering_dlq_messages_total",
    help: "Messages sent to the dead-letter queue by the consumer, by reason",
    labelNames: ["reason"],
    registers: [this.registry],
  });

  private readonly lockConflicts = new Counter({
    name: "wagering_lock_conflicts_total",
    help: "Concurrency conflicts that exhausted the retries",
    registers: [this.registry],
  });

  private readonly reconciliationMismatches = new Counter({
    name: "wagering_reconciliation_mismatches_total",
    help: "Reconciliations where the stored balance differs from the ledger",
    labelNames: ["currency"],
    registers: [this.registry],
  });

  private readonly processing = new Histogram({
    name: "wagering_processing_seconds",
    help: "Wager transaction processing latency",
    labelNames: ["source"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly published = new Counter({
    name: "wagering_events_published_total",
    help: "Integration events published from the outbox",
    registers: [this.registry],
  });

  readonly httpRequests = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration by route and status",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor(orm: MikroORM) {
    collectDefaultMetrics({ register: this.registry });

    // Outbox lag is read from the database on every scrape, so it is correct across all instances.
    const outboxPending = new Gauge({ name: "wagering_outbox_pending", help: "Unpublished outbox rows", registers: [this.registry] });
    new Gauge({
      name: "wagering_outbox_lag_seconds",
      help: "Age of the oldest unpublished outbox row (0 when empty)",
      registers: [this.registry],
      async collect() {
        try {
          const [row] = (await orm.em.fork().getConnection().execute(
            `select count(*)::int as pending,
                    coalesce(extract(epoch from now() - min("occurred_at")), 0)::float as lag
             from "outbox_messages" where "published_at" is null`,
          )) as Array<{ pending: number; lag: number }>;
          this.set(row?.lag ?? 0);
          outboxPending.set(row?.pending ?? 0);
        } catch {
          // database unavailable: keep the last value; readiness reports the outage
        }
      },
    });
  }

  transactionDecided(status: string, kind: string): void {
    this.transactions.inc({ status, kind });
  }

  duplicateDetected(source: DuplicateSource): void {
    this.duplicates.inc({ source });
  }

  retry(source: RetrySource): void {
    this.retries.inc({ source });
  }

  sentToDlq(reason: string): void {
    this.dlq.inc({ reason });
  }

  lockConflict(): void {
    this.lockConflicts.inc();
  }

  reconciliationMismatch(currency: string): void {
    this.reconciliationMismatches.inc({ currency });
  }

  observeProcessing(source: "http" | "sqs" | "pending_reference", seconds: number): void {
    this.processing.observe({ source }, seconds);
  }

  eventsPublished(count: number): void {
    this.published.inc(count);
  }
}

export { PrometheusMetrics };
