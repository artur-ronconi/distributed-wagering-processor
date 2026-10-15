import { api, waitFor, type Row, type Snapshot } from "../api";
import { session } from "../state";
import { S } from "./catalog";
import { emitDecision, emitPersist } from "./decision";
import { ms } from "./format";
import type { RunContext } from "./sink";

const TERMINAL = ["PROCESSED", "REJECTED", "FAILED"];

/**
 * Follows outbox rows after the commit: the publisher (another loop, maybe another instance) locks them,
 * sends to SQS and marks them published. Then this page, as the downstream consumer, receives them.
 */
const followOutbox = async (ctx: RunContext, rows: Row[], track?: string) => {
  if (rows.length === 0) return;
  const ids = rows.map((row) => row.id as string);
  const add: RunContext["trace"]["add"] = (def, extra = {}) => ctx.trace.add(def, { track, ...extra });

  const published = await waitFor(async () => {
    const current = await api.outbox(ids);
    return current.length === ids.length && current.every((row) => row.publishedAt) ? current : undefined;
  }, 15_000);

  if (!published) {
    add(S.publisherTick, {
      from: "worker",
      note: "não publicado em 15s: o publisher está ligado? (RUN_OUTBOX_PUBLISHER)",
      outcome: "fail",
      evidence: "observado",
    });
    return;
  }

  const delays = published.map((row) => ms(row.createdAt, row.publishedAt) ?? 0);
  add(S.publisherTick, {
    from: "worker",
    note: `pegou ${ids.length} evento(s) ~${Math.max(...delays)} ms depois do commit`,
    evidence: "observado",
  });
  add(S.lockOutbox, { note: `${ids.length} linha(s) travadas por esta instância`, tx: "begin" });
  for (const row of published) {
    add(
      { ...S.sqsPublish, title: `SendMessage: ${row.eventType}` },
      { note: `group ${row.aggregateId} · dedup ${row.id}`, evidence: "observado" },
    );
  }
  add(S.markPublished, {
    from: "sqs",
    note: published.map((row) => `${row.eventType}: +${ms(row.createdAt, row.publishedAt)} ms`).join(" · "),
    evidence: "observado",
    data: published.map(({ payload: _payload, ...rest }) => rest),
    outcome: "ok",
    tx: "commit",
  });
  ctx.trace.moveTo("sqs", track ?? "");

  const events = await waitFor(async () => {
    const received = await api.events(ids);
    return received.length === ids.length ? received : undefined;
  }, 6_000);
  if (!events) {
    add(S.downstream, {
      note: "evento não lido por este painel (FLOW_DRAIN_EVENTS=false?)",
      evidence: "observado",
      outcome: "fail",
    });
    return;
  }
  for (const event of events) {
    add({ ...S.downstream, title: `recebe ${event.eventType}` }, { note: `eventId ${event.eventId}`, evidence: "observado", data: event.payload });
  }
  ctx.record({ type: "events", title: "Eventos recebidos em wagering-events.fifo", events });
};

interface PendingOptions {
  track?: string;
  timeoutMs: number;
  /** Stop early (e.g. after the first retry) — the worker keeps going in the background. */
  stopAfterAttempts?: number;
  knownOutboxIds?: Set<string>;
}

/**
 * Watches a PENDING_REFERENCE transaction. Each retry of the worker shows up as `reference_attempts`
 * going up; the resolution shows up as a terminal status (with the ledger entry and outbox rows).
 */
const followPending = async (ctx: RunContext, transactionId: string, options: PendingOptions) => {
  const add: RunContext["trace"]["add"] = (def, extra = {}) => ctx.trace.add(def, { track: options.track, ...extra });
  const known = options.knownOutboxIds ?? new Set<string>();
  const deadline = Date.now() + options.timeoutMs;

  let last = await api.inspect({ transactionId });
  let attempts = Number(last.transaction?.referenceAttempts ?? 0);

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const current: Snapshot = await api.inspect({ transactionId });
    const tx = current.transaction;
    if (!tx) return current;

    const nowAttempts = Number(tx.referenceAttempts ?? 0);
    const terminal = TERMINAL.includes(tx.status as string);

    if (!terminal && nowAttempts > attempts) {
      for (let attempt = attempts + 1; attempt <= nowAttempts; attempt += 1) {
        add(S.pendingTick, { from: "worker", note: `tentativa ${attempt}`, evidence: "observado" });
        add(S.lockPending, { note: `${tx.externalTransactionId} · PENDING_REFERENCE`, tx: "begin" });
        add(S.workerLockWallet, { lock: "acquire" });
        emitDecision(ctx.trace, {
          track: options.track,
          origin: "worker",
          tx,
          reference: null,
          walletAtLock: current.wallet,
          ledger: [],
        });
        add(S.scheduleRetry, {
          note: `reference_attempts = ${attempt} · próxima em ${tx.nextReferenceAttemptAt}`,
          evidence: "observado",
        });
        add({ ...S.workerSave, from: "domain" }, { note: "continua PENDING_REFERENCE, nenhum evento" });
        add({ ...S.commit, from: "worker" }, { tx: "commit", lock: "release" });
      }
      attempts = nowAttempts;
      if (options.stopAfterAttempts && attempts >= options.stopAfterAttempts) return current;
    }

    if (terminal) {
      add(S.pendingTick, { from: "worker", note: `tentativa ${nowAttempts + 1}: a referência chegou`, evidence: "observado" });
      add(S.lockPending, { note: `${tx.externalTransactionId} · PENDING_REFERENCE`, tx: "begin" });
      add(S.workerLockWallet, { lock: "acquire" });
      const outbox = current.outbox.filter((row) => !known.has(row.id as string));
      const decision = emitDecision(ctx.trace, {
        track: options.track,
        origin: "worker",
        tx,
        reference: current.reference,
        walletAtLock: null,
        ledger: current.ledger,
      });
      if (decision === "reference-missing") {
        add(
          { ...S.reject, code: S.scheduleRetry.code },
          { note: "tentativas esgotadas → REJECTED · REFERENCE_NOT_FOUND", outcome: "fail", evidence: "observado" },
        );
      }
      emitPersist(ctx.trace, {
        track: options.track,
        origin: "worker",
        tx,
        walletAtLock: null,
        ledger: current.ledger,
        outbox,
        after: current,
      });
      ctx.record({ type: "snapshot", title: `Worker resolveu ${tx.externalTransactionId}`, before: last, after: current });
      if (current.wallet) session.updateBalance(current.wallet.id as string, current.wallet.balanceAmount as string);
      await followOutbox(ctx, outbox, options.track);
      return current;
    }
    last = current;
  }
  return last;
};

export { followOutbox, followPending };
