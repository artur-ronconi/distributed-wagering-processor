/** Client of the local visualizer server (frontends/flow-explorer/server.ts). */

type Row = Record<string, any>;

interface HttpExchange {
  request: { method: string; path: string; headers: Record<string, string>; body?: unknown };
  status: number;
  headers: Record<string, string>;
  body: any;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

interface Snapshot {
  at: string;
  wallet: Row | null;
  ledgerTotals: { calculated: string; entries: number } | null;
  transaction: Row | null;
  reference: Row | null;
  externalIdOwner: Row | null;
  ledger: Row[];
  outbox: Row[];
  inbox: Row | null;
  outboxPending: number;
}

interface InspectQuery {
  walletId?: string;
  playerId?: string;
  currency?: string;
  idempotencyKey?: string;
  transactionId?: string;
  providerId?: string;
  externalTransactionId?: string;
  referenceExternalTransactionId?: string;
  openingOfWallet?: string;
  messageId?: string;
}

interface ReceivedEvent {
  eventId: string;
  eventType: string;
  groupId: string | null;
  receivedAt: string;
  payload: any;
}

interface QueueDepth {
  queue: string;
  visible: number;
  inFlight: number;
}

const post = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data as T;
};

const get = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data as T;
};

const api = {
  async http(method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) {
    const result = await post<Omit<HttpExchange, "request">>("/api/http", { method, path, ...init });
    return { ...result, request: { method, path, headers: init.headers ?? {}, body: init.body } } as HttpExchange;
  },
  inspect: (query: InspectQuery) => post<Snapshot>("/api/inspect", query),
  outbox: (ids: string[]) => get<Row[]>(`/api/outbox?ids=${ids.join(",")}`),
  status: () => get<Record<string, any>>("/api/status"),
  logs: (match: string, sinceSeconds = 60) =>
    get<{ lines: any[] | null }>(`/api/logs?match=${encodeURIComponent(match)}&since=${sinceSeconds}`),
  sendMessage: (body: string, groupId: string, deduplicationId: string) =>
    post<{ sqsMessageId: string; sequenceNumber: string; sentAt: string; queue: string }>("/api/sqs/send", {
      body,
      groupId,
      deduplicationId,
    }),
  depth: () => get<QueueDepth[]>("/api/sqs/depth"),
  dlq: () => get<Array<{ sqsMessageId: string; failureCode: string | null; body: unknown }>>("/api/sqs/dlq"),
  events: (ids: string[]) => get<ReceivedEvent[]>(`/api/sqs/events?ids=${ids.join(",")}`),
  recentEvents: (limit = 30) => get<ReceivedEvent[]>(`/api/sqs/events?limit=${limit}`),
  async source(file: string): Promise<string | null> {
    const response = await fetch(`/api/source?file=${encodeURIComponent(file)}`);
    return response.ok ? response.text() : null;
  },
};

/** Polls `probe` until it returns a value (not undefined) or the timeout passes. */
const waitFor = async <T>(probe: () => Promise<T | undefined>, timeoutMs: number, everyMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export { api, sleep, waitFor, type HttpExchange, type InspectQuery, type QueueDepth, type ReceivedEvent, type Row, type Snapshot };
