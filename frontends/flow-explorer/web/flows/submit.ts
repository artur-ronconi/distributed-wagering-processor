import { api, waitFor, type HttpExchange, type InspectQuery, type Row, type Snapshot } from "../api";
import { session } from "../state";
import { followOutbox, followPending } from "./async";
import { F, S } from "./catalog";
import { emitDecision, emitPersist } from "./decision";
import { money, walletLine } from "./format";
import type { Extra, RunContext, Sink } from "./sink";
import type { StepDef } from "./types";

interface SubmitInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
}

/** Which path the use case took, deduced from the response (HTTP) or the consumer log (SQS). */
type CoreOutcome =
  | { kind: "decided" }
  | { kind: "replay" }
  | { kind: "key-conflict" }
  | { kind: "external-used" }
  | { kind: "wallet-not-found" }
  | { kind: "lock-timeout" }
  | { kind: "invalid"; where: "dto" | "header" | "prepare"; message: string }
  | { kind: "duplicate" }
  | { kind: "malformed" }
  | { kind: "unknown"; code?: string };

interface SubmitEvidence {
  track?: string;
  input: SubmitInput;
  before: Snapshot;
  after: Snapshot;
  outcome: CoreOutcome;
  /** Wallet as seen when the lock was taken (differs from `before` when another request committed first). */
  walletAtLock?: Row | null;
}

const bodyOf = (input: SubmitInput) => ({
  providerId: input.providerId,
  externalTransactionId: input.externalTransactionId,
  playerId: input.playerId,
  walletId: input.walletId,
  roundId: input.roundId,
  gameId: input.gameId,
  kind: input.kind,
  money: { amount: input.amount, currency: input.currency },
  ...(input.referenceExternalTransactionId ? { referenceExternalTransactionId: input.referenceExternalTransactionId } : {}),
});

const queryOf = (input: SubmitInput, messageId?: string): InspectQuery => ({
  walletId: input.walletId,
  idempotencyKey: input.idempotencyKey,
  providerId: input.providerId,
  externalTransactionId: input.externalTransactionId,
  referenceExternalTransactionId: input.referenceExternalTransactionId || undefined,
  messageId,
});

const MISSING_KEY_MESSAGE = "Idempotency-Key header is required";

const outcomeFromHttp = (exchange: HttpExchange, before: Snapshot): CoreOutcome => {
  const { status, body } = exchange;
  if (status === 201 || status === 202 || status === 422) return { kind: "decided" };
  if (status === 200 && body?.idempotentReplay) return { kind: "replay" };
  if (status === 409) return before.transaction ? { kind: "key-conflict" } : { kind: "external-used" };
  if (status === 404) return { kind: "wallet-not-found" };
  if (status === 503) return { kind: "lock-timeout" };
  if (status === 400) {
    const message = String(body?.message ?? "");
    if (message.includes(MISSING_KEY_MESSAGE)) return { kind: "invalid", where: "header", message };
    // class-validator messages ("x must be…", "x should not…") come from the DTO, the rest from the domain.
    const fromDto = / must | should /.test(message);
    return { kind: "invalid", where: fromDto ? "dto" : "prepare", message };
  }
  return { kind: "unknown", code: body?.code };
};

const outcomeFromConsumer = (reason: string, before: Snapshot): CoreOutcome => {
  if (reason === "MALFORMED_MESSAGE") return { kind: "malformed" };
  if (reason === "DUPLICATE_MESSAGE") return { kind: "duplicate" };
  if (["PROCESSED", "REJECTED", "PENDING_REFERENCE"].includes(reason)) {
    return before.transaction ? { kind: "replay" } : { kind: "decided" };
  }
  if (reason === "IDEMPOTENCY_CONFLICT") return before.transaction ? { kind: "key-conflict" } : { kind: "external-used" };
  if (reason === "WALLET_NOT_FOUND") return { kind: "wallet-not-found" };
  if (reason === "TRANSIENT_FAILURE") return { kind: "lock-timeout" };
  if (reason === "INVALID_PAYLOAD" || reason === "INVALID_AMOUNT") return { kind: "invalid", where: "prepare", message: reason };
  return { kind: "unknown", code: reason };
};

/** prepare() → BEGIN → (inbox) → idempotency → lock → checks → decide → writes → COMMIT/ROLLBACK. */
const emitCore = (sink: Sink, ev: SubmitEvidence, viaInbox: boolean) => {
  const add = (def: StepDef, extra: Extra = {}) => sink.add(def, { track: ev.track, ...extra });
  const { outcome, before, after, input } = ev;

  const invalid = outcome.kind === "invalid" && outcome.where === "prepare";
  add(S.prepare, {
    note: `${input.kind} ${money(input.amount, input.currency)} · nasce PENDING`,
    branch: { question: "conteúdo válido?", answer: invalid ? `não → ${outcome.message}` : "sim" },
    outcome: invalid ? "fail" : "ok",
  });
  if (invalid) return;

  add(S.begin(), { tx: "begin" });

  if (viaInbox) {
    const duplicate = outcome.kind === "duplicate";
    add(S.inboxRegister, {
      branch: { question: "messageId já registrado?", answer: duplicate ? "sim → já aplicada" : "não → registra" },
      outcome: duplicate ? "fail" : "ok",
      evidence: "observado",
      data: after.inbox ?? undefined,
    });
    if (duplicate) {
      add({ ...S.commit, from: "usecase" }, { tx: "commit", note: "nada é reaplicado: só falta o ack" });
      return;
    }
  }

  const existing = before.transaction;
  add(S.idempotencyLookup, {
    branch: { question: "a Idempotency-Key já existe?", answer: existing ? `sim (${existing.status})` : "não" },
    evidence: "observado",
    data: existing ?? undefined,
  });

  if (existing) {
    const replay = outcome.kind === "replay";
    add(S.replayCheck, {
      branch: { question: "mesmo payloadHash?", answer: replay ? "sim → replay" : "não → conflito" },
      outcome: replay ? "ok" : "fail",
      note: replay
        ? `devolve o resultado original: ${existing.status}, saldo observado ${money(existing.observedBalanceAmount, existing.currency)}`
        : "IDEMPOTENCY_CONFLICT",
    });
    if (replay) {
      if (viaInbox) add(S.inboxProcessed, { evidence: "observado" });
      add(S.commit, { tx: "commit", note: "nenhum saldo, ledger ou outbox alterado" });
    } else {
      add(S.rollback, { tx: "rollback", note: "nada é gravado" });
    }
    return;
  }

  if (outcome.kind === "wallet-not-found") {
    add(S.lockWallet, {
      branch: { question: "a carteira existe?", answer: "não" },
      outcome: "fail",
      evidence: "observado",
    });
    add(S.rollback, { tx: "rollback", note: "WALLET_NOT_FOUND" });
    return;
  }

  if (outcome.kind === "lock-timeout") {
    add(S.lockWallet, { lock: "wait", note: "esperando o lock da carteira…" });
    add(S.lockTimeout, { outcome: "fail", evidence: "observado" });
    add(S.rollback, { tx: "rollback" });
    return;
  }

  const walletAtLock = ev.walletAtLock ?? before.wallet;
  add(S.lockWallet, { lock: "acquire", note: `🔒 ${walletLine(walletAtLock)}`, evidence: "observado", data: walletAtLock ?? undefined });
  add(S.recheckIdempotency, { branch: { question: "alguém gravou enquanto esperávamos o lock?", answer: "não" } });

  const externalUsed = outcome.kind === "external-used";
  add(S.externalIdCheck, {
    branch: {
      question: "externalTransactionId já usado com outra key?",
      answer: externalUsed ? `sim (key ${before.externalIdOwner?.idempotencyKey})` : "não",
    },
    outcome: externalUsed ? "fail" : "ok",
    evidence: "observado",
  });
  if (externalUsed) {
    add(S.rollback, { tx: "rollback", lock: "release", note: "IDEMPOTENCY_CONFLICT" });
    return;
  }

  const tx = after.transaction;
  if (outcome.kind !== "decided" || !tx) {
    add(S.rollback, { tx: "rollback", lock: "release", note: "erro inesperado (veja a resposta)", outcome: "fail" });
    return;
  }

  const decision = emitDecision(sink, {
    track: ev.track,
    origin: "usecase",
    tx,
    reference: before.reference,
    walletAtLock,
    ledger: after.ledger,
  });
  if (decision === "reference-missing") {
    add(S.referenceMissing, { note: `próxima tentativa: ${tx.nextReferenceAttemptAt}`, evidence: "observado" });
  }

  emitPersist(sink, {
    track: ev.track,
    origin: "usecase",
    tx,
    walletAtLock,
    ledger: after.ledger,
    outbox: after.outbox.filter((row) => !before.outbox.some((old) => old.id === row.id)),
    inbox: viaInbox ? after.inbox : undefined,
    after,
  });
};

const STATUS_FOR: StepDef = {
  lane: "entry",
  from: "usecase",
  kind: "return",
  title: "statusFor(resultado)",
  detail:
    "O resultado de negócio vira status HTTP: REJECTED → `422` (com o resultado no corpo), PENDING_REFERENCE → `202`, replay → `200`, novo → `201`.",
  code: { file: F.submitCtrl, anchor: "const statusFor = ", span: 5 },
};

const emitHttp = (sink: Sink, ev: SubmitEvidence & { exchange: HttpExchange }) => {
  const add = (def: StepDef, extra: Extra = {}) => sink.add(def, { track: ev.track, ...extra });
  const { exchange, outcome } = ev;

  add(S.httpRequest("POST", "/wagering/transactions", F.submitCtrl, "@Post()"), {
    note: `Idempotency-Key: ${ev.input.idempotencyKey || "(vazio)"} · ${ev.input.kind} ${money(ev.input.amount, ev.input.currency)}`,
    evidence: "observado",
    data: exchange.request,
  });
  add(S.correlationId, { note: exchange.headers["x-correlation-id"], evidence: "observado" });
  add(S.authGuard, {});

  const dtoInvalid = outcome.kind === "invalid" && outcome.where === "dto";
  add(S.validationPipe, {
    branch: { question: "formato do corpo válido?", answer: dtoInvalid ? "não" : "sim" },
    outcome: dtoInvalid ? "fail" : "ok",
    note: dtoInvalid ? outcome.message : undefined,
  });

  const headerMissing = outcome.kind === "invalid" && outcome.where === "header";
  if (!dtoInvalid) {
    add(S.submitController, {
      branch: { question: "Idempotency-Key presente?", answer: headerMissing ? "não" : "sim" },
      outcome: headerMissing ? "fail" : "ok",
    });
  }

  if (!dtoInvalid && !headerMissing) {
    add(S.submitExecute, {});
    emitCore(sink, ev, false);
  }

  const status = exchange.status;
  if ([200, 201, 202, 422].includes(status)) {
    add(STATUS_FOR, { note: `${exchange.body?.status}${exchange.body?.idempotentReplay ? " (replay)" : ""} → ${status}` });
  } else {
    add({ ...(dtoInvalid ? S.exceptionFilter : S.httpError), from: dtoInvalid || headerMissing ? "entry" : "usecase" }, {
      note: `${exchange.body?.code}: ${exchange.body?.message}`,
      evidence: "observado",
      outcome: "fail",
    });
  }
  add(S.httpResponse(status, F.submitCtrl, "response.status(statusFor(outcome))"), {
    note: summarize(exchange),
    evidence: "observado",
    data: exchange.body,
    outcome: status >= 400 ? "fail" : "ok",
  });
};

const summarize = (exchange: HttpExchange) => {
  const body = exchange.body;
  if (body?.status) {
    const balance = body.balance ? ` · saldo ${body.balance.amount}` : "";
    return `${body.status}${body.failureCode ? ` · ${body.failureCode}` : ""}${balance}${body.idempotentReplay ? " · replay" : ""}`;
  }
  return body?.code ? `${body.code}` : `${exchange.durationMs} ms`;
};

const rememberTransaction = (input: SubmitInput, after: Snapshot) => {
  if (after.wallet) session.updateBalance(after.wallet.id as string, after.wallet.balanceAmount as string);
  const tx = after.transaction;
  if (!tx) return;
  session.upsertTransaction({
    transactionId: tx.id as string,
    providerId: tx.providerId as string,
    externalTransactionId: tx.externalTransactionId as string,
    idempotencyKey: tx.idempotencyKey as string,
    walletId: tx.walletId as string,
    playerId: tx.playerId as string,
    roundId: tx.roundId as string,
    kind: tx.kind as string,
    amount: tx.amount as string,
    currency: (tx.currency as string) ?? input.currency,
    status: tx.status as string,
  });
};

/** Sends the request and takes "before" / "after" snapshots. No steps yet (see emitHttp). */
const collectHttp = async (input: SubmitInput, track?: string): Promise<SubmitEvidence & { exchange: HttpExchange }> => {
  const query = queryOf(input);
  const before = await api.inspect(query);
  const exchange = await api.http("POST", "/wagering/transactions", {
    headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {},
    body: bodyOf(input),
  });
  const after = await api.inspect(query);
  return { track, input, before, after, exchange, outcome: outcomeFromHttp(exchange, before) };
};

/** Follow-up after the response: outbox publication and, for PENDING_REFERENCE, the worker. */
const followUp = async (ctx: RunContext, ev: SubmitEvidence, pendingTimeoutMs: number) => {
  const newRows = ev.after.outbox.filter((row) => !ev.before.outbox.some((old) => old.id === row.id));
  await followOutbox(ctx, newRows, ev.track);
  const tx = ev.after.transaction;
  if (tx?.status === "PENDING_REFERENCE" && pendingTimeoutMs > 0 && ev.outcome.kind === "decided") {
    await followPending(ctx, tx.id as string, {
      track: ev.track,
      timeoutMs: pendingTimeoutMs,
      stopAfterAttempts: 1,
      knownOutboxIds: new Set(ev.after.outbox.map((row) => row.id as string)),
    });
  }
};

const runSubmitHttp = async (
  ctx: RunContext,
  input: SubmitInput,
  options: { track?: string; title?: string; pendingTimeoutMs?: number } = {},
) => {
  const ev = await collectHttp(input, options.track);
  ctx.record({ type: "http", title: options.title ?? `POST /wagering/transactions (${input.kind})`, exchange: ev.exchange, track: options.track });
  emitHttp(ctx.trace, ev);
  ctx.record({ type: "snapshot", title: "Banco: antes → depois", before: ev.before, after: ev.after, track: options.track });
  rememberTransaction(input, ev.after);
  await followUp(ctx, ev, options.pendingTimeoutMs ?? 3_500);
  return ev;
};

// ------------------------------------------------------------------ SQS

interface MessageOptions {
  messageId: string;
  deduplicationId?: string;
  /** Sends this raw body instead of a valid envelope (malformed message). */
  rawBody?: string;
  track?: string;
  title?: string;
}

const envelopeOf = (input: SubmitInput, messageId: string) =>
  JSON.stringify({
    messageId,
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: { ...bodyOf(input), idempotencyKey: input.idempotencyKey },
  });

/** The consumer logs one "wager message handled" line per message, with the verdict and the reason. */
const waitConsumerLog = async (sqsMessageId: string) =>
  waitFor(
    async () => {
      const { lines } = await api.logs(sqsMessageId, 120);
      if (lines === null) return null; // logs unavailable (app not under docker compose)
      const line = lines.find(
        (entry: any) => typeof entry === "object" && entry?.msg === "wager message handled" && entry?.sqsMessageId === sqsMessageId,
      );
      return line ?? undefined;
    },
    20_000,
    600,
  );

const runSubmitSqs = async (ctx: RunContext, input: SubmitInput, options: MessageOptions) => {
  const add = (def: StepDef, extra: Extra = {}) => ctx.trace.add(def, { track: options.track, ...extra });
  const query = queryOf(input, options.messageId);
  const before = await api.inspect(query);
  const body = options.rawBody ?? envelopeOf(input, options.messageId);
  const sent = await api.sendMessage(body, input.walletId || "visualizer", options.deduplicationId ?? options.messageId);

  let parsedBody: unknown = body;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    // malformed on purpose
  }
  ctx.record({ type: "message", title: options.title ?? "Mensagem enviada para wager-transactions.fifo", payload: parsedBody, meta: sent });
  add(S.sqsSend, {
    note: `messageId ${options.messageId} · group ${input.walletId || "visualizer"} · dedup ${options.deduplicationId ?? options.messageId}`,
    evidence: "observado",
    data: parsedBody,
  });

  const log = (await waitConsumerLog(sent.sqsMessageId)) as Record<string, any> | null | undefined;
  const after = await waitFor(
    async () => {
      const snapshot = await api.inspect(query);
      return log || snapshot.inbox?.processedAt ? snapshot : undefined;
    },
    log ? 1_000 : 10_000,
  ) ?? (await api.inspect(query));

  if (!log) {
    ctx.record({
      type: "note",
      title: "Log do consumer indisponível",
      text: log === null
        ? "A app não está rodando via docker compose, então o veredito (ack/retry/DLQ) foi deduzido só pelo banco."
        : "O consumer não registrou esta mensagem em 20s. Ele está ligado (RUN_SQS_CONSUMER)?",
      tone: "warn",
    });
  } else {
    ctx.record({ type: "logs", title: "Log do consumer (pino)", lines: [log] });
  }

  const reason: string = log?.reason ?? (after.inbox?.processedAt ? after.transaction?.status ?? "PROCESSED" : "UNKNOWN");
  const verdict: string = log?.verdict ?? (after.inbox?.processedAt ? "ack" : "?");
  const ev: SubmitEvidence = { track: options.track, input, before, after, outcome: outcomeFromConsumer(reason, before) };

  add(S.sqsReceive, {
    note: log ? `receiveCount ${log.receiveCount}` : undefined,
    evidence: log ? "observado" : "inferido",
  });
  const malformed = ev.outcome.kind === "malformed";
  add(S.sqsParse, {
    branch: { question: "envelope WagerTransactionRequested válido?", answer: malformed ? "não" : "sim" },
    outcome: malformed ? "fail" : "ok",
  });

  if (!malformed) {
    add(S.sqsExecute, {});
    emitCore(ctx.trace, ev, true);
  }

  if (verdict === "ack") add(S.sqsAck, { note: `verdict ack · reason ${reason}`, evidence: log ? "observado" : "inferido", outcome: "ok" });
  else if (verdict === "dlq") add({ ...S.sqsDlq, from: malformed ? "entry" : "usecase" }, { note: `failureCode = ${reason}`, evidence: "observado", outcome: "fail" });
  else if (verdict === "retry") add(S.sqsRetry, { note: `reason ${reason}`, evidence: "observado", outcome: "fail" });

  ctx.record({ type: "snapshot", title: "Banco: antes → depois", before, after, track: options.track });
  rememberTransaction(input, after);
  if (!malformed && ev.outcome.kind === "decided") await followUp(ctx, ev, 3_500);
  return { ev, log, sent };
};

export {
  collectHttp,
  emitHttp,
  followUp,
  rememberTransaction,
  runSubmitHttp,
  runSubmitSqs,
  type SubmitEvidence,
  type SubmitInput,
};
