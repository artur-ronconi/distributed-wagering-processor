import { type INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";

import packageJson from "../../../../package.json";
import { MESSAGING_MODELS } from "./messaging-contracts.dto";

const DESCRIPTION = `
Financial service that applies **wager transactions** sent by game providers to player **wallets**, keeping the balance and an immutable **ledger** correct even when messages are **duplicated**, arrive **out of order** or are processed **concurrently** by several instances.

## Who calls this API

Game **providers** (and the casino backend, to create wallets). Players never call it directly.

There are two entry points for the same operation, with the same rules and the same result:

| | HTTP \`POST /wagering/transactions\` | SQS \`wager-transactions.fifo\` |
|---|---|---|
| Style | synchronous: the result comes in the response | asynchronous: query \`GET /providers/{providerId}/wagering/transactions/{externalTransactionId}\` or listen to the events |
| If the service is down | you get an error and retry | the message waits in the queue |

## Money

Always \`{ "amount": "25.00", "currency": "BRL" }\`: a **string with exactly 2 decimal places**, never a JSON number. \`"25"\`, \`"25.0"\`, \`"25.005"\`, \`"1e3"\` and negative values are rejected.

## Idempotency

\`POST /wagering/transactions\` requires the \`Idempotency-Key\` header (recommended: \`{providerId}:{externalTransactionId}\`). The server stores a SHA-256 of the canonical JSON (sorted keys) of the business fields:

- same key + same payload → **original result**, \`idempotentReplay: true\`, balance of that moment;
- same key + different payload → \`409 IDEMPOTENCY_CONFLICT\`, nothing stored.

Retry after a timeout or a \`503\` **with the same key**: it is always safe.

## HTTP status codes

| Situation | Status | Retry? |
|---|---|---|
| Processed now / created | \`201\` | — |
| Query, idempotent replay of a processed transaction, reconciliation | \`200\` | — |
| Accepted, waiting for the referenced transaction (\`PENDING_REFERENCE\`) | \`202\` | no, query later |
| Invalid payload | \`400\` | only after fixing it |
| Not found | \`404\` | only after fixing it |
| Conflict | \`409\` | no |
| Rejected by a business rule (\`REJECTED\` + \`failureCode\`) | \`422\` | no, the outcome does not change |
| Transient failure (database/SQS) | \`503\` + \`Retry-After\` | **yes, same key** |
| Unexpected error | \`500\` | yes, same key |

Errors always have the body \`{ "code", "message", "correlationId" }\`. Decide using \`code\`, never \`message\`.

## Failure codes

| code | status | stored as REJECTED? | what to do |
|---|---|---|---|
| \`INVALID_PAYLOAD\` | 400 | no | fix the request |
| \`INVALID_AMOUNT\` | 400 | no | fix the amount |
| \`WALLET_NOT_FOUND\` / \`TRANSACTION_NOT_FOUND\` | 404 | no | fix the id |
| \`IDEMPOTENCY_CONFLICT\` | 409 | no | use another key only if it is another operation |
| \`WALLET_ALREADY_EXISTS\` | 409 | — | do not create again |
| \`WALLET_PLAYER_MISMATCH\` | 422 | yes | give up |
| \`CURRENCY_MISMATCH\` | 422 | yes | give up |
| \`INSUFFICIENT_FUNDS\` | 422 | yes | give up |
| \`REVERSAL_WOULD_OVERDRAW\` | 422 | yes | manual handling |
| \`REFERENCE_NOT_FOUND\` | 422 (after the retry limit) | yes | check that the reference was sent |
| \`REFERENCE_KIND_NOT_ALLOWED\` / \`REFERENCE_MISMATCH\` / \`REFERENCE_AMOUNT_MISMATCH\` / \`REFERENCE_NOT_PROCESSED\` / \`REFERENCE_ALREADY_REVERSED\` | 422 | yes | give up |
| \`TRANSIENT_FAILURE\` | 503 | no | retry with the same key |
| \`INTERNAL_ERROR\` | 500 | no | retry with the same key |

## Out-of-order references

A REFUND or ROLLBACK that arrives before the transaction it references is stored as **\`PENDING_REFERENCE\`** (\`202\`) and retried in the background with exponential backoff. It becomes \`PROCESSED\` when the reference arrives, or \`REJECTED\` with \`REFERENCE_NOT_FOUND\` after the retry limit.

## Correlation

Send \`X-Correlation-Id\` (optional) to follow a request across logs and events. It is always returned in the response.

## Events

Integration events are published to \`wagering-events.fifo\` through a transactional outbox (never before the commit, at least once): \`WagerTransactionProcessed\`, \`WagerTransactionRejected\`, \`WalletBalanceChanged\` (only when the balance changes) and \`WagerTransactionPendingReference\`. Deduplicate by \`eventId\`. Schemas: \`IntegrationEventEnvelopeDto\`, \`WalletBalanceChangedDataDto\`, \`WagerTransactionEventDataDto\`; queue input message: \`WagerTransactionRequestedMessageDto\`.
`;

const CUSTOM_CSS = `
  .swagger-ui .topbar { display: none; }
  .swagger-ui .info { margin: 32px 0 16px; }
  .swagger-ui .info .title { font-size: 32px; }
  .swagger-ui .info .markdown table { margin: 12px 0; }
  .swagger-ui .opblock-tag { font-size: 20px; }
  .swagger-ui .opblock .opblock-summary-description { font-weight: 500; }
`;

const buildOpenApiDocument = (app: INestApplication): OpenAPIObject => {
  const config = new DocumentBuilder()
    .setTitle("Distributed Wagering Processor API")
    .setVersion(packageJson.version)
    .setDescription(DESCRIPTION)
    .addServer("http://localhost:3000", "Local (docker compose)")
    .addTag("Wallets", "Create wallets, read balances, the ledger and reconcile")
    .addTag("Wagering", "Submit and query BET, WIN, LOSS, REFUND and ROLLBACK")
    .addTag("Providers", "Query transactions by the provider's own id")
    .addTag("Health", "Liveness and readiness probes (no authentication)")
    .build();

  return SwaggerModule.createDocument(app, config, { extraModels: MESSAGING_MODELS });
};

const setupSwagger = (app: INestApplication): OpenAPIObject => {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs/json",
    customSiteTitle: "Wagering Processor — API Docs",
    customCss: CUSTOM_CSS,
    swaggerOptions: {
      docExpansion: "list",
      filter: true,
      displayRequestDuration: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
      defaultModelsExpandDepth: 1,
      syntaxHighlight: { theme: "monokai" },
    },
  });
  return document;
};

export { setupSwagger, buildOpenApiDocument };
