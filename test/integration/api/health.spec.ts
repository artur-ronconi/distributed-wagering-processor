import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { http, startTestApp, type TestApp } from "../../support/app";
import { ShutdownState } from "../../../src/infrastructure/health/shutdown-state";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => app.close());

describe("health and metrics (no authentication)", () => {
  it("GET /health/live answers without touching dependencies", async () => {
    const response = await http(app.url, "GET", "/health/live");
    expect(response).toMatchObject({ status: 200, body: { status: "ok" } });
  });

  it("GET /health/ready checks PostgreSQL and SQS", async () => {
    const response = await http(app.url, "GET", "/health/ready");
    expect(response.status).toBe(200);
    expect(response.body.checks.postgres.status).toBe("up");
    expect(response.body.checks.sqs.status).toBe("up");
  });

  it("GET /metrics exposes Prometheus metrics", async () => {
    const response = await http(app.url, "GET", "/metrics");
    expect(response.status).toBe(200);
    expect(response.body).toContain("wagering_outbox_lag_seconds");
    expect(response.body).toContain("http_request_duration_seconds");
  });

  it("readiness answers 503 once shutdown starts, liveness stays 200", async () => {
    app.app.get(ShutdownState).beforeApplicationShutdown("SIGTERM");
    const ready = await http(app.url, "GET", "/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body.shuttingDown).toBe(true);
    expect((await http(app.url, "GET", "/health/live")).status).toBe(200);
  });
});
