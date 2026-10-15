import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import SwaggerParser from "@apidevtools/swagger-parser";

import { http, startTestApp, type TestApp } from "../../support/app";

let app: TestApp;
let document: any;

/** Every route and status documented in docs/routes must be in the OpenAPI document. */
const EXPECTED: Record<string, Record<string, number[]>> = {
  "/wallets": { post: [201, 400, 409, 503, 500] },
  "/wallets/{walletId}": { get: [200, 400, 404, 503, 500] },
  "/wallets/{walletId}/ledger": { get: [200, 400, 404, 503, 500] },
  "/wallets/{walletId}/reconciliation": { post: [200, 400, 404, 503, 500] },
  "/wallets/{walletId}/deposits": { post: [201, 200, 400, 404, 409, 422, 503, 500] },
  "/wallets/{walletId}/withdrawals": { post: [201, 200, 400, 404, 409, 422, 503, 500] },
  "/wagering/transactions": { post: [201, 200, 202, 400, 404, 409, 422, 503, 500] },
  "/wagering/transactions/{transactionId}": { get: [200, 400, 404, 503, 500] },
  "/providers/{providerId}/wagering/transactions/{externalTransactionId}": { get: [200, 400, 404, 503, 500] },
  "/health/live": { get: [200] },
  "/health/ready": { get: [200, 503] },
};

beforeAll(async () => {
  app = await startTestApp();
  document = (await http(app.url, "GET", "/docs/json")).body;
});
afterAll(async () => app.close());

describe("Swagger / OpenAPI", () => {
  it("is served at /docs (UI) and /docs/json (valid OpenAPI 3)", async () => {
    const ui = await fetch(`${app.url}/docs`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain("Wagering Processor");

    expect(document.openapi).toMatch(/^3\./);
    await SwaggerParser.validate(structuredClone(document));
  });

  it("documents exactly the API routes (no internal endpoints)", () => {
    expect(Object.keys(document.paths).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [path, operations] of Object.entries(EXPECTED)) {
    for (const [method, statuses] of Object.entries(operations)) {
      it(`${method.toUpperCase()} ${path} documents ${statuses.join(", ")} with schema and examples`, () => {
        const operation = document.paths[path][method];
        expect(operation.operationId).toBeTruthy();
        expect(operation.summary).toBeTruthy();
        expect(operation.description).toBeTruthy();
        expect(operation.tags).toHaveLength(1);

        for (const status of statuses) {
          const response = operation.responses[String(status)];
          expect(response).toBeDefined();
          expect(response.description).toBeTruthy();
          const content = response.content?.["application/json"];
          expect(content?.schema).toBeDefined();
          expect(Object.keys(content?.examples ?? {}).length + (content?.example ? 1 : 0)).toBeGreaterThan(0);
        }
      });
    }
  }

  it("submit requires Idempotency-Key and has one named example per kind", () => {
    const operation = document.paths["/wagering/transactions"].post;
    const header = operation.parameters.find((p: { name: string }) => p.name === "Idempotency-Key");
    expect(header).toMatchObject({ in: "header", required: true });
    expect(Object.keys(operation.requestBody.content["application/json"].examples).sort()).toEqual(
      ["bet", "loss", "refund", "rollback", "win"],
    );
    expect(operation.responses["503"].headers["Retry-After"]).toBeDefined();
  });

  it.each(["/wallets/{walletId}/deposits", "/wallets/{walletId}/withdrawals"])(
    "%s requires Idempotency-Key and documents the body and the rejection",
    (path) => {
      const operation = document.paths[path].post;
      const header = operation.parameters.find((p: { name: string }) => p.name === "Idempotency-Key");
      expect(header).toMatchObject({ in: "header", required: true });
      expect(operation.tags).toEqual(["Wallets"]);
      expect(operation.requestBody.content["application/json"].schema.$ref).toContain("WalletOperationRequestDto");
      expect(Object.keys(operation.responses["422"].content["application/json"].examples)).toContain("currencyMismatch");
    },
  );

  it("withdrawal documents INSUFFICIENT_FUNDS", () => {
    const examples = document.paths["/wallets/{walletId}/withdrawals"].post.responses["422"].content["application/json"].examples;
    expect(examples.insufficientFunds.value.failureCode).toBe("INSUFFICIENT_FUNDS");
  });

  it("exposes reusable schemas, named enums and the messaging contracts", () => {
    const schemas = Object.keys(document.components.schemas);
    for (const name of [
      "MoneyDto",
      "ErrorResponseDto",
      "WalletResponseDto",
      "LedgerPageDto",
      "ReconciliationResponseDto",
      "WagerTransactionDto",
      "WagerTransactionResultDto",
      "FailureCode",
      "WagerTransactionStatus",
      "WagerTransactionKind",
      "LedgerDirection",
      "WagerTransactionRequestedMessageDto",
      "IntegrationEventEnvelopeDto",
      "WalletBalanceChangedDataDto",
      "WalletOperationRequestDto",
    ]) {
      expect(schemas).toContain(name);
    }
    expect(document.components.schemas.FailureCode.enum).toContain("INSUFFICIENT_FUNDS");
    expect(document.components.schemas.WagerTransactionKind.enum).toEqual(expect.arrayContaining(["DEPOSIT", "WITHDRAWAL"]));
    expect(document.components.schemas.MoneyDto.properties.amount.pattern).toBeTruthy();
  });

  it("has a rich description and ordered tags", () => {
    expect(document.info.description).toContain("Idempotency");
    expect(document.info.description).toContain("REVERSAL_WOULD_OVERDRAW");
    expect(document.tags.map((t: { name: string }) => t.name)).toEqual(["Wallets", "Wagering", "Providers", "Health"]);
  });
});
