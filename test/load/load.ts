/**
 * Load test (optional differential, OLD_README §14): `bun run test:load` against a running stack
 * (`bun run start`). Two scenarios, both through the public HTTP API:
 *
 *  1. spread: many wallets, each with its own stream of bets/wins (the normal case);
 *  2. hot wallet: one wallet receiving every request at once (the worst case for the row lock).
 *
 * It reports throughput, p50/p95/p99, error rate, concurrency conflicts and outbox lag, then checks
 * the financial invariant (stored balance == ledger) with the reconciliation endpoint of every wallet.
 * There is no RPS target: the point is the honest measurement and a final consistency check.
 */
import { cpus, platform, release, totalmem } from "node:os";

const BASE_URL = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const WALLETS = Number(process.env.LOAD_WALLETS ?? 200);
const REQUESTS_PER_WALLET = Number(process.env.LOAD_REQUESTS_PER_WALLET ?? 20);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 64);
const HOT_REQUESTS = Number(process.env.LOAD_HOT_REQUESTS ?? 1_000);
const HOT_CONCURRENCY = Number(process.env.LOAD_HOT_CONCURRENCY ?? 50);
const RUN_ID = Date.now().toString(36);

interface Sample {
  status: number;
  ms: number;
}

const api = async (method: string, path: string, body?: unknown, key?: string) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await response.json().catch(() => null);
    return { status: response.status, ms: performance.now() - startedAt, json };
  } catch {
    return { status: 0, ms: performance.now() - startedAt, json: null }; // network error / timeout
  }
};

const createWallet = async (label: string, amount: string): Promise<string> => {
  const response = await api("POST", "/wallets", {
    playerId: `load-${RUN_ID}-${label}`,
    initialBalance: { amount, currency: "BRL" },
  });
  if (response.status !== 201) throw new Error(`could not create wallet ${label}: ${response.status}`);
  return response.json.id as string;
};

const submit = (walletId: string, label: string, n: number, kind: "BET" | "WIN", amount: string): Promise<Sample> => {
  const externalTransactionId = `load-${RUN_ID}-${label}-${n}`;
  const body = {
    providerId: "load-provider",
    externalTransactionId,
    playerId: `load-${RUN_ID}-${label}`,
    walletId,
    roundId: `round-${n}`,
    gameId: "fortune-chimp",
    kind,
    money: { amount, currency: "BRL" },
  };
  return api("POST", "/wagering/transactions", body, `load-provider:${externalTransactionId}`).then(
    ({ status, ms }) => ({ status, ms }),
  );
};

/** Runs `tasks` with at most `limit` in flight. */
const pool = async <T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

const metric = async (name: string): Promise<number> => {
  const text = await fetch(`${BASE_URL}/metrics`).then((r) => r.text());
  return text
    .split("\n")
    .filter((line) => line.startsWith(`${name} `) || line.startsWith(`${name}{`))
    .reduce((sum, line) => sum + Number(line.split(" ").pop()), 0);
};

interface Report {
  name: string;
  requests: number;
  seconds: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  byStatus: Record<string, number>;
  errorRate: number;
  lockConflicts: number;
}

/** 2xx/422 are answers (a 422 is a business rejection, not a failure). 5xx, 0 (network) and 4xx other than 422 are errors. */
const isError = (status: number) => !(status >= 200 && status < 300) && status !== 422;

const measure = async (name: string, tasks: Array<() => Promise<Sample>>, concurrency: number): Promise<Report> => {
  const conflictsBefore = await metric("wagering_lock_conflicts_total");
  const startedAt = performance.now();
  const samples = await pool(tasks, concurrency);
  const seconds = (performance.now() - startedAt) / 1000;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byStatus: Record<string, number> = {};
  for (const { status } of samples) byStatus[status] = (byStatus[status] ?? 0) + 1;

  return {
    name,
    requests: samples.length,
    seconds,
    rps: samples.length / seconds,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
    byStatus,
    errorRate: samples.filter((s) => isError(s.status)).length / samples.length,
    lockConflicts: (await metric("wagering_lock_conflicts_total")) - conflictsBefore,
  };
};

/** Samples the outbox lag while it drains after the load; returns the worst lag seen and the drain time. */
const watchOutbox = async (): Promise<{ maxLagSeconds: number; maxPending: number; drainSeconds: number }> => {
  const startedAt = performance.now();
  let maxLagSeconds = 0;
  let maxPending = 0;
  for (let i = 0; i < 600; i += 1) {
    const [lag, pending] = await Promise.all([metric("wagering_outbox_lag_seconds"), metric("wagering_outbox_pending")]);
    maxLagSeconds = Math.max(maxLagSeconds, lag);
    maxPending = Math.max(maxPending, pending);
    if (pending === 0) break;
    await Bun.sleep(250);
  }
  return { maxLagSeconds, maxPending, drainSeconds: (performance.now() - startedAt) / 1000 };
};

const fmt = (n: number, digits = 1) => n.toFixed(digits);

const printReport = (r: Report) => {
  console.log(`\n── ${r.name}`);
  console.log(`   requests ${r.requests} in ${fmt(r.seconds, 2)}s → ${fmt(r.rps)} req/s`);
  console.log(`   latency  p50 ${fmt(r.p50)} ms · p95 ${fmt(r.p95)} ms · p99 ${fmt(r.p99)} ms · max ${fmt(r.max)} ms`);
  console.log(`   status   ${JSON.stringify(r.byStatus)}`);
  console.log(`   errors   ${fmt(r.errorRate * 100, 2)}% · lock conflicts that exhausted retries: ${r.lockConflicts}`);
};

const reconcile = async (walletIds: string[]): Promise<{ checked: number; inconsistent: string[] }> => {
  const inconsistent: string[] = [];
  await pool(
    walletIds.map((id) => async () => {
      const response = await api("POST", `/wallets/${id}/reconciliation`);
      if (response.status !== 200 || response.json?.consistent !== true) inconsistent.push(id);
    }),
    16,
  );
  return { checked: walletIds.length, inconsistent };
};

const main = async () => {
  const ready = await api("GET", "/health/ready");
  if (ready.status !== 200) throw new Error(`${BASE_URL} is not ready (${ready.status}). Run: bun run start`);

  console.log("Load test: Distributed Wagering Processor");
  console.log(`Environment: ${platform()} ${release()} · ${cpus().length} CPUs (${cpus()[0]?.model.trim()}) · ${fmt(totalmem() / 1024 ** 3)} GiB RAM · bun ${Bun.version}`);
  console.log(`Target: ${BASE_URL} (docker compose: 1 app instance, PostgreSQL 17, LocalStack)`);

  // Scenario 1: spread
  const spreadWallets = await Promise.all(
    Array.from({ length: WALLETS }, async (_, i) => ({ label: `w${i}`, id: await createWallet(`w${i}`, "1000000.00") })),
  );
  const spreadTasks = spreadWallets.flatMap(({ id, label }) =>
    Array.from({ length: REQUESTS_PER_WALLET }, (_, n) => () =>
      submit(id, label, n, n % 4 === 3 ? "WIN" : "BET", "1.00"),
    ),
  );
  // interleave wallets so that neighbours in the queue are different wallets
  spreadTasks.sort(() => Math.random() - 0.5);
  const spread = await measure(`Scenario 1, spread: ${WALLETS} wallets × ${REQUESTS_PER_WALLET} requests, ${CONCURRENCY} in flight`, spreadTasks, CONCURRENCY);
  printReport(spread);
  const spreadOutbox = await watchOutbox();

  // Scenario 2: hot wallet
  const hotId = await createWallet("hot", "1000000.00");
  const hotTasks = Array.from({ length: HOT_REQUESTS }, (_, n) => () => submit(hotId, "hot", n, "BET", "1.00"));
  const hot = await measure(`Scenario 2, hot wallet: ${HOT_REQUESTS} bets on ONE wallet, ${HOT_CONCURRENCY} in flight`, hotTasks, HOT_CONCURRENCY);
  printReport(hot);
  const hotOutbox = await watchOutbox();

  // Replays under load: the same request again must be answered as a replay, never applied twice
  const replayWallet = await createWallet("replay", "1000.00");
  const first = await submit(replayWallet, "replay", 0, "BET", "10.00");
  const replays = await pool(Array.from({ length: 50 }, () => () => submit(replayWallet, "replay", 0, "BET", "10.00")), 25);
  const replayBalance = (await api("GET", `/wallets/${replayWallet}`)).json?.balance?.amount;

  console.log(`\n── Outbox`);
  console.log(`   after scenario 1: worst lag ${fmt(spreadOutbox.maxLagSeconds, 2)}s, ${spreadOutbox.maxPending} pending at most, drained in ${fmt(spreadOutbox.drainSeconds, 1)}s`);
  console.log(`   after scenario 2: worst lag ${fmt(hotOutbox.maxLagSeconds, 2)}s, ${hotOutbox.maxPending} pending at most, drained in ${fmt(hotOutbox.drainSeconds, 1)}s`);

  console.log(`\n── Idempotency under load`);
  console.log(`   first ${first.status}, then 50 identical requests in parallel: ${JSON.stringify(replays.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {}))}`);
  console.log(`   balance after replays: ${replayBalance} (expected 990.00)`);

  const { checked, inconsistent } = await reconcile([...spreadWallets.map((w) => w.id), hotId, replayWallet]);
  console.log(`\n── Final invariant (stored balance == ledger)`);
  console.log(`   ${checked} wallets reconciled, ${inconsistent.length} inconsistent${inconsistent.length ? `: ${inconsistent.join(", ")}` : ""}`);

  const failed =
    inconsistent.length > 0 ||
    replayBalance !== "990.00" ||
    spread.errorRate > 0 ||
    hot.errorRate > 0;
  console.log(failed ? "\nRESULT: FAILED (see above)" : "\nRESULT: OK, no errors and every wallet consistent");
  process.exit(failed ? 1 : 0);
};

await main();
