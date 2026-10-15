import index from "./web/index.html";
import { config } from "./server/config";
import { inspect, outboxByIds, ping as pingDb, type InspectQuery } from "./server/db";
import { appLogs } from "./server/logs";
import { readSource } from "./server/source";
import {
  depth,
  eventsByIds,
  peekDlq,
  ping as pingSqs,
  recentEvents,
  sendWagerMessage,
  startEventsDrain,
} from "./server/sqs";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const fail = (error: unknown, status = 502) =>
  json({ error: error instanceof Error ? error.message : String(error) }, status);

const guarded =
  (handler: (req: Request) => Promise<Response>) =>
  async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      return fail(error);
    }
  };

const settle = async (probe: () => Promise<unknown>) => {
  const startedAt = performance.now();
  try {
    await probe();
    return { up: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { up: false, error: (error as Error).message };
  }
};

interface ProxyRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Forwards a call to the backend API (it has no CORS) and reports timing. */
const proxy = async (req: Request) => {
  const input = (await req.json()) as ProxyRequest;
  if (!input.path?.startsWith("/")) return json({ error: "path must start with /" }, 400);

  const startedAt = new Date();
  const t0 = performance.now();
  const response = await fetch(`${config.apiUrl}${input.path}`, {
    method: input.method,
    headers: { "content-type": "application/json", ...(input.headers ?? {}) },
    body: input.body === undefined ? undefined : typeof input.body === "string" ? input.body : JSON.stringify(input.body),
  });
  const durationMs = Math.round(performance.now() - t0);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (e.g. /metrics)
  }

  return json({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    durationMs,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  });
};

startEventsDrain();

const server = Bun.serve({
  port: config.port,
  development: true,
  routes: {
    "/": index,

    "/api/status": {
      GET: async () => {
        const [api, db, sqs] = await Promise.all([
          settle(async () => {
            const response = await fetch(`${config.apiUrl}/health/live`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          }),
          settle(pingDb),
          settle(pingSqs),
        ]);
        return json({ api, db, sqs, apiUrl: config.apiUrl, drainEvents: config.drainEvents, repoRoot: config.repoRoot });
      },
    },

    "/api/http": { POST: guarded(proxy) },

    "/api/inspect": {
      POST: guarded(async (req) => json(await inspect((await req.json()) as InspectQuery))),
    },

    "/api/outbox": {
      GET: guarded(async (req) => {
        const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
        return json(await outboxByIds(ids));
      }),
    },

    "/api/source": {
      GET: guarded(async (req) => {
        const file = new URL(req.url).searchParams.get("file") ?? "";
        const text = await readSource(file);
        return text === null ? json({ error: "not found" }, 404) : new Response(text);
      }),
    },

    "/api/logs": {
      GET: guarded(async (req) => {
        const params = new URL(req.url).searchParams;
        const match = params.get("match") ?? "";
        if (match.length < 4) return json({ error: "match too short" }, 400);
        return json({ lines: await appLogs(match, Number(params.get("since") ?? 60)) });
      }),
    },

    "/api/sqs/send": {
      POST: guarded(async (req) =>
        json(await sendWagerMessage((await req.json()) as { body: string; groupId: string; deduplicationId: string })),
      ),
    },

    "/api/sqs/depth": {
      GET: guarded(async () =>
        json(await Promise.all([depth(config.queues.wager), depth(config.queues.dlq), depth(config.queues.events)])),
      ),
    },

    "/api/sqs/dlq": { GET: guarded(async () => json(await peekDlq())) },

    "/api/sqs/events": {
      GET: guarded(async (req) => {
        const params = new URL(req.url).searchParams;
        const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
        return json(ids.length > 0 ? eventsByIds(ids) : recentEvents(Number(params.get("limit") ?? 30)));
      }),
    },
  },
  fetch: () => json({ error: "not found" }, 404),
});

console.log(`Flow visualizer: http://localhost:${server.port}  (API ${config.apiUrl})`);
