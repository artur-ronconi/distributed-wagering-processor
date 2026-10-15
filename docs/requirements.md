# Requirements

Condensed from `OLD_README.md` (the challenge statement). **`OLD_README.md` is the source of truth**: if anything here disagrees with it, `OLD_README.md` wins.

`README.md` is a **deliverable** of this project (setup and commands, OLD_README §14). It does not exist yet and is not the challenge statement.

## Documentation map

| What | Where |
|---|---|
| Domain classes (one file per domain, code with `ddd-tool-kit`) | @docs/domain/ — start at @docs/domain/shared.md |
| Routes (one file per route: request, flow, responses, errors, files, tests) | @docs/routes/ — start at @docs/routes/shared.md |
| File templates | @docs/files-patterns/ |
| Project conventions for agents | `CLAUDE.md` |

# Eliminatory failures (OLD_README §14)
- `number` / float for money
- Negative balance caused by a race condition
- Duplicated debit or credit
- Idempotency only in memory
- Solution correct only with a single instance
- Publishing an event before the commit
- No auditable ledger
- Tests that fully replace PostgreSQL and SQS with mocks

# Technical Requirements

## Stack
| Layer                         | Tech                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| **Runtime / PM / Tests**      | Bun 1.x                                                              |
| **Language**                  | TypeScript (strict mode)                                             |
| **Framework**                 | NestJS                                                               |
| **Database**                  | PostgreSQL                                                           |
| **ORM**                       | MikroORM (preferred) or TypeORM. **Prisma and others are out of scope** |
| **Messaging**                 | AWS SQS via LocalStack or MiniStack                                  |
| **Local orchestration**       | Docker Compose (no manual steps: queues and migrations are created on startup) |
| **Migrations**                | Versioned and reversible (`up` and `down`)                           |
| **API documentation**         | **Swagger / OpenAPI 3 via `@nestjs/swagger`** (see "API documentation (Swagger)") |
| **Authentication**            | Optional. If implemented, external IdP (Keycloak, Zitadel). Never an own users table with password hashes |
| **DDD base classes**          | `ddd-tool-kit@2.3.0`                                                 |

The choice of ORM, the `Money` mapping and the transaction strategy must be justified in `ARCHITECTURE.md`.

## For file creation templates, you can follow these guidelines:
- For Aggregate Roots use @docs/files-patterns/aggregate-root.md
- For Entities use @docs/files-patterns/entity.md
- For ValueObjects use @docs/files-patterns/value-object.md
- For Services (use cases) use @docs/files-patterns/service.md
- For Controllers use @docs/files-patterns/controller.md
- For Schemas and migrations use @docs/files-patterns/schema.md
- For Repositories use @docs/files-patterns/repository.md
- For Unidirectional Mappers use @docs/files-patterns/unidirectional-mapper.md
- For Bidirectional Mappers use @docs/files-patterns/bidirectional-mapper.md
- For domain classes use @docs/domain/
- For routes use @docs/routes/

## The **generally** correct flow should follow these guidelines:
- GET: client->controller->service->repository->PostgreSQL->BidirectionalMapper (`rehydrate`)->AggregateRoot->service->UnidirectionalMapper->Dto->controller->client
- GET of history (ledger page, reconciliation sums): client->controller->service->**read query (port)**->PostgreSQL->Dto. History is never loaded into an aggregate.
- POST (create): client->controller->service->AggregateRoot (`create`/`open`)->**UnitOfWork transaction**->repository->BidirectionalMapper->PostgreSQL->service->controller->client
- POST that changes money (`/wagering/transactions`): client or SQS consumer->service->**UnitOfWork opens ONE transaction**->repository (lock the wallet)->BidirectionalMapper->AggregateRoot->**change in memory using domain methods**->repositories save transaction + wallet (with its new ledger entries) + outbox (+ inbox when coming from SQS)->**COMMIT**->controller returns / consumer acks
- Repositories never open their own transaction. The service decides the transaction boundary.

## Routes (OLD_README §9)

Callers are **game providers** (and the casino backend for wallet creation), never the player directly. All routes are plain HTTP; no API gateway is required. Full detail per route in @docs/routes/.

| Method | Endpoint | Description | Also via SQS? | Doc |
| ------ | -------- | ----------- | ------------- | --- |
| `POST` | `/wallets` | Create wallet (internal `OPENING` if initial balance > 0) | no | @docs/routes/create-wallet.md |
| `GET`  | `/wallets/:walletId` | Wallet and materialized balance | no | @docs/routes/get-wallet.md |
| `GET`  | `/wallets/:walletId/ledger?cursor=...&limit=50` | Ledger, keyset pagination, stable opaque cursor | no | @docs/routes/get-wallet-ledger.md |
| `POST` | `/wallets/:walletId/reconciliation` | Stored balance vs ledger; divergences logged + metric, never auto-fixed | no | @docs/routes/reconcile-wallet.md |
| `POST` | `/wallets/:walletId/deposits` | **Extension.** Deposit (internal `DEPOSIT`, credit); header `Idempotency-Key` required, scoped to the wallet | no | @docs/routes/deposit-to-wallet.md |
| `POST` | `/wallets/:walletId/withdrawals` | **Extension.** Withdrawal (internal `WITHDRAWAL`, debit, never below zero); header `Idempotency-Key` required | no | @docs/routes/withdraw-from-wallet.md |
| `POST` | `/wagering/transactions` | Submit BET/WIN/LOSS/REFUND/ROLLBACK (header `Idempotency-Key` required) | **yes** | @docs/routes/submit-wager-transaction.md |
| `GET`  | `/wagering/transactions/:transactionId` | Transaction by internal id | no | @docs/routes/get-wager-transaction.md |
| `GET`  | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Transaction by provider id | no | @docs/routes/get-provider-wager-transaction.md |
| `GET`  | `/health/live` | Process alive, no I/O (no auth) | no | @docs/routes/health.md |
| `GET`  | `/health/ready` | PostgreSQL and SQS reachable (no auth); `503` during SIGTERM | no | @docs/routes/health.md |
| `GET`  | `/docs`, `/docs/json` | Swagger UI and OpenAPI JSON (no auth) | no | see "API documentation (Swagger)" |

### HTTP status mapping (same in every route)
| Situation | Status |
|---|---|
| Created / processed now | `201` |
| Query ok, idempotent replay of `PROCESSED`, reconciliation (consistent or not) | `200` |
| Accepted, waiting for reference (`PENDING_REFERENCE`) | `202` |
| Invalid payload (`INVALID_PAYLOAD`, `INVALID_AMOUNT`) | `400` |
| Not found (`WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`) | `404` |
| Conflict (`IDEMPOTENCY_CONFLICT`, `WALLET_ALREADY_EXISTS`) | `409` |
| Business rejection (`INSUFFICIENT_FUNDS`, `REFERENCE_*`...) — also on replay of a rejected transaction | `422` |
| Transient infrastructure failure | `503` + `Retry-After` |
| Unexpected error | `500` (`INTERNAL_ERROR`) |

- Error body: `{ "code": "<FailureCode>", "message": "...", "correlationId": "..." }`. Exception: `POST /wagering/transactions`, `/deposits` and `/withdrawals` with `REJECTED` return the transaction result (with `failureCode`).
- Submit result body: `{ transactionId, status, balance, failureCode, idempotentReplay }`. `balance` is the balance **observed when the transaction was decided** (replay returns the old one); `null` while `PENDING_REFERENCE`.
- Headers: `Idempotency-Key` (required on submit), `X-Correlation-Id` (optional in, always echoed out), `Retry-After` (on `503`), `Authorization` (if auth is implemented).
- Validation split: DTOs (class-validator) check **shape**; the domain checks **content** (money format, kinds, references). The SQS consumer gets the same content validation.

## Queues (OLD_README §10)

The queue is a **second entry point** parallel to HTTP, only for submitting wager transactions. It is not a layer in front of the API, and there is no queue per route (GETs need an immediate answer; wallet creation and reconciliation are rare administrative operations).

| Queue | Purpose |
|---|---|
| `wager-transactions.fifo` | input of `WagerTransactionRequested` messages (`MessageGroupId = walletId` as an optimization only) |
| `wager-transactions-dlq.fifo` | permanent failures and messages over `maxReceiveCount` (redrive policy) |
| `wagering-events.fifo` (our name) | output: integration events published by the outbox worker (`MessageGroupId = aggregateId`, `MessageDeduplicationId = eventId`) |

| Service result for a message | Action |
|---|---|
| `PROCESSED`, `REJECTED`, `PENDING_REFERENCE`, replay, or inbox already had the `messageId` | **ack** (definitive result is in the database) |
| `INVALID_PAYLOAD`, `INVALID_AMOUNT`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND` (nothing persisted) | **DLQ** (auditable instead of lost) |
| `TRANSIENT_FAILURE` or unexpected error | **no ack** → redelivered after the visibility timeout with backoff → DLQ after `maxReceiveCount` |

The consumer reuses the HTTP use case, deduplicates with the inbox `(consumerName, messageId)`, acks **only after the commit**, and on `SIGTERM` finishes in-flight messages or returns their visibility.

## API documentation (Swagger)

The API must be documented with **Swagger / OpenAPI 3** through `@nestjs/swagger`. The documentation is part of the deliverable and must be **complete, accurate and pleasant to read**: a provider should be able to integrate using only it. The content of each route comes from its file in @docs/routes/; both must stay in sync.

### Access
- Swagger UI at `GET /docs`, OpenAPI JSON at `GET /docs/json` (`SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs/json" })`).
- Public (outside the `AuthGuard`) and available right after `docker compose up`, no manual steps.

### Document-level content (`DocumentBuilder`)
- Title `Distributed Wagering Processor API`, version from `package.json`, `servers` with `http://localhost:3000`.
- A **Markdown description** at the top with:
  - what the service does and who calls it (providers, not players);
  - the two entry points (HTTP and SQS) and that both use the same rules;
  - the money format (`{ "amount": "25.00", "currency": "BRL" }`, exactly 2 decimals, never numbers);
  - how idempotency works (`Idempotency-Key`, `payloadHash`, replay vs `409`);
  - the HTTP status mapping table and the full `failureCode` table (code, status, what the provider should do);
  - `X-Correlation-Id`, ledger pagination with cursor, and the `PENDING_REFERENCE` lifecycle.
- **Tags** with descriptions, in this order: `Wallets`, `Wagering`, `Providers`, `Health`.
- `addBearerAuth()` only if authentication is implemented.

### Per operation
- `operationId`, `summary` (one line) and `description` (business rules, idempotency and concurrency notes where they apply).
- Every path param, query param and header documented with type, `pattern`, limits and `example`:
  - `walletId`/`transactionId`: 16 chars;
  - `limit`: 1–200, default 50; `cursor`: opaque;
  - `Idempotency-Key`: **required** on submit, with an example (`provider-a:transaction-123`); `X-Correlation-Id`: optional.
- **Every possible response status** of the route (as listed in its @docs/routes file), each with its schema and at least one **named example**. For `POST /wagering/transactions`: `201` processed, `200` replay, `202` pending reference, `400`, `404`, `409`, `422` (rejected, with `failureCode`), `503` (with the `Retry-After` header documented).
- Request bodies with **named examples per scenario**. `POST /wagering/transactions` has one example per kind: `BET`, `WIN`, `LOSS`, `REFUND` and `ROLLBACK` (the last two with `referenceExternalTransactionId`).

### Schemas (`components`)
- Reusable named schemas: `Money`, `ErrorResponse`, `Wallet`, `LedgerEntry`, `LedgerPage`, `Reconciliation`, `WagerTransaction`, `WagerTransactionResult`, `HealthLive`, `HealthReady`.
- Every DTO property with `@ApiProperty({ description, example, ... })`, `required` correct, `nullable: true` where it can be `null`, `pattern` for money (`^(0|[1-9]\d{0,16})\.\d{2}$`) and currency (`^[A-Z]{3}$`), `maxLength` for external ids.
- Enums as **named components** (`enumName`): `WagerTransactionKind`, `WagerTransactionStatus`, `LedgerDirection`, `FailureCode`. `ErrorResponse.code` uses the `FailureCode` enum.
- Messaging contracts (not covered by OpenAPI paths) also documented as schemas and referenced in the description: the input message `WagerTransactionRequested` and the four integration events.

### Decorators are explicit
The app runs TypeScript directly on Bun, so the `@nestjs/swagger` CLI compiler plugin does not run. Every `@ApiProperty`, `@ApiResponse`, `@ApiHeader`, `@ApiParam`, `@ApiQuery`, `@ApiBody` and `@ApiOperation` is written explicitly.

### Look and feel
- `customSiteTitle: "Wagering Processor — API Docs"`, and `customCss` for a clean header (hide the default top bar, readable spacing).
- `swaggerOptions`: `docExpansion: "list"`, `filter: true`, `displayRequestDuration: true`, `persistAuthorization: true`, `tryItOutEnabled: true`, `defaultModelsExpandDepth: 1`, `syntaxHighlight: { theme: "monokai" }`.
- Operations ordered as in the routes table above, so the UI reads as a guided tour (wallets → wagering → providers → health).

### Quality gate (test)
- An integration test fetches `/docs/json`, validates it as a valid OpenAPI 3 document (e.g. `@apidevtools/swagger-parser`) and asserts that every route and every status listed in @docs/routes is present with a schema and an example.

## Tests 🧪 (OLD_README §13)
- Unit:
  - `Money` operations and validations (scale, rounding, invalid inputs)
  - `Wallet` invariants
  - `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK` rules
  - Currency conflict
  - Idempotency key with a different payload
- Integration (real PostgreSQL and LocalStack/MiniStack in containers):
  - Migrations and constraints
  - Atomicity between wallet, ledger, inbox and outbox
  - Inbox and redelivery
  - Concurrent publishers on the same outbox
  - Retry and DLQ
  - Recovery after restart
  - Every route as described in its @docs/routes file, plus the Swagger quality gate
- Concurrency (real parallelism, not sequential mocks):
  1. The same bet sent 50 times in parallel → a single debit
  2. Concurrent operations competing for the same wallet balance (100.00, two bets of 80.00)
  3. Different wallets processed in parallel
  4. ≥ 3 processes/instances at the same time
  5. Worker killed after the commit and before the ack
  6. Two publishers on the same outbox
  7. `ROLLBACK` or `REFUND` delivered before its reference
  8. Service restart, proving final consistency
- Final invariant of every test: `wallet.balance == balance rebuilt from the ledger`

---

# Functional Requirements

## Operations (OLD_README §7)
| Operation  | Balance              | Ledger              | Main rule |
| ---------- | -------------------- | ------------------- | --------- |
| `OPENING`  | credit               | 1 `CREDIT`          | Internal only, created with the wallet. Never accepted by the API or the queue |
| `BET`      | debit                | 1 `DEBIT`           | Rejected if balance is insufficient |
| `WIN`      | credit               | 1 `CREDIT`          | May reference the `BET` of the same round |
| `LOSS`     | none                 | none                | Records the result without moving balance (amount may be `0.00`) |
| `REFUND`   | credit               | 1 `CREDIT`          | Reverts a `PROCESSED` `BET`, only once |
| `ROLLBACK` | inverse of reference | 1 inverted entry    | Reverts a `PROCESSED` `BET`, `WIN` or `REFUND`, only once |
| `DEPOSIT`    | credit             | 1 `CREDIT`          | **Extension.** Internal (`POST /wallets/:walletId/deposits`); positive amount, wallet currency |
| `WITHDRAWAL` | debit              | 1 `DEBIT`           | **Extension.** Internal (`POST /wallets/:walletId/withdrawals`); rejected with `INSUFFICIENT_FUNDS` if the balance does not cover it |

Internal kinds (`OPENING`, `DEPOSIT`, `WITHDRAWAL`) are never accepted from a provider (API or queue): `400 INVALID_PAYLOAD`, and the database only allows them with `provider_id = 'internal'`.

## Rules
1. `REFUND` and `ROLLBACK` require `referenceExternalTransactionId`.
2. The reference is resolved by `(providerId, referenceExternalTransactionId)` and must belong to the same provider, player, wallet, currency and round.
3. `REFUND` only references `BET`. `ROLLBACK` references `BET`, `WIN` or `REFUND`. `WIN` only references `BET`.
4. A reference cannot be reverted twice by the same kind of operation (repository check + partial unique index).
5. `REFUND`/`ROLLBACK` amount must equal the reference amount (no partial reversal).
6. A `REJECTED` transaction does not change the balance nor creates a ledger entry.
7. Repeating an already processed operation returns the **original result**, including the balance observed at that moment.
8. Missing reference → persist as `PENDING_REFERENCE`; a scheduled worker retries with exponential backoff until a limit/TTL, then `REJECTED` with `REFERENCE_NOT_FOUND` and the matching event.
9. A reversal that would make the balance negative is rejected with `REVERSAL_WOULD_OVERDRAW`, **different** from a bet's `INSUFFICIENT_FUNDS`.
10. Every rejection carries a stable, machine-readable `failureCode` (taxonomy in @docs/domain/shared.md).
11. Interpretation adopted (documented in `ARCHITECTURE.md`): a reference is reverted **at most once in total** — a `BET` that was refunded cannot also be rolled back (rule 4 literally says "same kind", which would allow crediting it twice).

## Idempotency
- The `Idempotency-Key` header is required and is the source of truth. Default: `"{providerId}:{externalTransactionId}"`. Via SQS it comes in `data.idempotencyKey`.
- `payloadHash` = SHA-256 (hex) of a **canonical JSON** (keys sorted at every level, no spaces, absent fields omitted) of the business fields only: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`. Headers, `messageId`, `occurredAt` and transport metadata are not part of it. HTTP and SQS produce the same hash for the same operation. Algorithm in @docs/routes/submit-wager-transaction.md; must be documented in `ARCHITECTURE.md`.
- Same key + same hash → original result with `idempotentReplay: true`.
- Same key + different hash → `409 IDEMPOTENCY_CONFLICT`, **not** replay, nothing persisted.
- Concurrent identical requests: `UNIQUE (idempotency_key)` lets one insert win; the others roll back, re-read and answer as replay.
- Inbox (transport level, SQS only) and idempotency key (business level, HTTP and SQS) overlap on SQS redelivery. Both are kept: the inbox is required by OLD_README §10 and gives a separate metric for redeliveries. Explain the overlap in `ARCHITECTURE.md`.

## Concurrency (OLD_README §8)
- The unit of concurrency is the `walletId`. No global lock.
- Adopted strategy: pessimistic row lock (`SELECT ... FOR UPDATE` on the wallet) + update conditioned on `version` as a safety net. Must be justified.
- Mandatory scenario: balance `100.00 BRL`, two simultaneous bets of `80.00 BRL` → exactly one `PROCESSED`, one `REJECTED` (insufficient funds), final balance `20.00 BRL`, exactly one debit ledger entry, no retry duplicates the debit.

---

# Domain Model (OLD_README §6)

Full code in @docs/domain/. Names and signatures may be adapted as long as the guarantees are preserved. Private constructor + static factories (`create`/`from`/`open`/`receive`/`enqueue` validate and return `Output`; `rehydrate` does **not** revalidate transitions).

## Aggregates and repositories
Only aggregate roots have a repository; child entities are saved through their root.

| Aggregate (class) | Contains | Repository | Doc |
|---|---|---|---|
| `WalletAggregate` | `WalletLedgerEntryEntity` children — only the **new** entries of the current unit of work (`newLedgerEntries`); history is never loaded | `WalletRepository` (updates the wallet + inserts new entries) | @docs/domain/wallet.md, @docs/domain/wallet-ledger-entry.md |
| `WagerTransactionAggregate` | root only | `WagerTransactionRepository` | @docs/domain/wager-transaction.md |
| `InboxMessageAggregate` (messaging) | root only | `InboxMessageRepository` | @docs/domain/inbox-message.md |
| `OutboxMessageAggregate` (messaging) | root only | `OutboxMessageRepository` | @docs/domain/outbox-message.md |

Value object: `MoneyValueObject` (@docs/domain/money.md). Integration events live in the application layer (@docs/domain/integration-event.md).

Aggregates reference each other **by id** (`WagerTransaction.walletId`). Trade-off to document: DDD recommends one aggregate per transaction, but here one SQL transaction saves `Wallet` + `WagerTransaction` + inbox + outbox because OLD_README §6.5 and §11 require atomicity.

```
MoneyValueObject (ValueObject, immutable)
  from({ amount, currency }) → Output, zero(currency)
  add, subtract, negate, isZero, isPositive, isNegative, isLessThan, equals, toJSON, toString
  internal: bigint cents; may be negative internally; "never negative" is a Wallet rule

WalletAggregate (Aggregate root)
  id, playerId, currency, balance, version, newLedgerEntries, createdAt, updatedAt
  open({ id, playerId, initialBalance, openingTransactionId }) → Output (version 1 + OPENING entry if > 0)
  rehydrate(state) (no new entries)
  debit(money, transactionId, insufficientFundsError?) / credit(money, transactionId) → Output<entry>
  pullNewLedgerEntries() (used by WalletRepository.save)

WalletLedgerEntryEntity (child of Wallet, immutable: Object.freeze, no setters, no transitions)
  id, walletId, transactionId, direction (DEBIT | CREDIT), money, balanceBefore, balanceAfter, createdAt
  create(props) validates balanceBefore ± money === balanceAfter, rehydrate(state)

WagerTransactionAggregate (Aggregate root with lifecycle)
  id, providerId, externalTransactionId, idempotencyKey, payloadHash, walletId, playerId, roundId, gameId,
  kind, money, referenceExternalTransactionId?, status, referenceTransactionId?, failureCode?,
  observedBalance?, processedAt?, referenceAttempts, nextReferenceAttemptAt?
  create(props) → PENDING (rejects OPENING), createOpening(props) → PROCESSED, rehydrate(state)
  markPendingReference(nextAttemptAt), scheduleReferenceRetry(nextAttemptAt),
  markProcessed(referenceTransactionId, at, observedBalance), reject(code, at, observedBalance?), fail(code, at)
  isTerminal(), affectsBalance(), requiresReference(), matchesPayload(hash), ledgerDirectionFor(reference?),
  validateReference(reference) → Output
  invalid transition → throws InvalidTransactionStateError

  kind:   OPENING | BET | WIN | LOSS | REFUND | ROLLBACK
  status: PENDING | PENDING_REFERENCE | PROCESSED | REJECTED | FAILED  (last three are terminal)

InboxMessageAggregate (messaging)
  messageId, consumerName, payloadHash, receivedAt (= createdAt), processedAt?
  receive(props), rehydrate(state), isProcessed(), matchesPayload(hash), markProcessed(at)

OutboxMessageAggregate (messaging)
  id (= eventId), aggregateId, eventType, payload, occurredAt, attempts, nextAttemptAt, publishedAt?
  enqueue(event: IOutboxEvent), rehydrate(state), isPending(), isDue(now), markPublished(at),
  scheduleRetry(now) (1s, 2s, 4s… max 5 min)
```

## `ddd-tool-kit` facts that shape the code
- `IdValueObject` accepts only **16-char** ids (not UUID). Our ids → `char(16)`; external ids (`playerId`, `providerId`, `messageId`...) → `string`/`text`.
- The base constructor already calls `sanitizeProps()`. `Entity` creates `id`; `Aggregate` also creates `createdAt`/`updatedAt`.
- `verifyAllPropsExists` checks getters with `!!` (never list fields that can be `0`). `verifyAreEntities` validates arrays of child entities.
- `props` fields are mutable (only the reference is readonly) → structural immutability needs `Object.freeze`.
- `IError` has no code → every error is an `IDomainError` (`IError` + `code: FailureCode`).

## Failure codes
`INVALID_PAYLOAD`, `IDEMPOTENCY_CONFLICT`, `WALLET_ALREADY_EXISTS`, `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `WALLET_PLAYER_MISMATCH`, `CURRENCY_MISMATCH`, `INVALID_AMOUNT`, `INSUFFICIENT_FUNDS`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_KIND_NOT_ALLOWED`, `REFERENCE_MISMATCH`, `REFERENCE_AMOUNT_MISMATCH`, `REFERENCE_NOT_PROCESSED`, `REFERENCE_ALREADY_REVERSED`, `TRANSIENT_FAILURE`, `INTERNAL_ERROR`. HTTP status, whether it is persisted and the provider action for each: @docs/domain/shared.md.

## Integration events (OLD_README §11)
- `IntegrationEvent<T>` is an abstract class in the **application** layer (envelope: `eventId`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt`, `data`, `toJSON()`), with one concrete subclass per event. `eventType` and `version` live on the subclass type. The domain outbox depends only on the `IOutboxEvent` interface.
- `data` carries `MoneyProps` (decimal strings), never `MoneyValueObject` instances.

| Result | Events |
|---|---|
| `PROCESSED` with balance change (`BET`, `WIN`, `REFUND`, `ROLLBACK`, `OPENING`) | `WagerTransactionProcessed` + `WalletBalanceChanged` |
| `PROCESSED` without balance change (`LOSS`) | `WagerTransactionProcessed` |
| `REJECTED` | `WagerTransactionRejected` |
| `PENDING_REFERENCE` | `WagerTransactionPendingReference` |
| Idempotent replay | none |

- Published only through the transactional outbox. Publishers run on N instances (`FOR UPDATE SKIP LOCKED`), at-least-once; consumers deduplicate by `eventId`.

## Persistence guarantees enforced by the database (OLD_README §5.9)
- Money columns: `numeric(19,2)` + `char(3)`. Our ids: `char(16)`.
- `wallets`: `UNIQUE (player_id, currency)`, `CHECK (balance_amount >= 0)`, `CHECK (version >= 1)`.
- `wager_transactions`: `UNIQUE (idempotency_key)`, `UNIQUE (provider_id, external_transaction_id)`, `CHECK` of kind/status, `CHECK` reference required for `REFUND`/`ROLLBACK`, `CHECK` `failure_code` when `REJECTED`, partial unique index `(reference_transaction_id) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')` (one reversal per reference, any kind), index for due `PENDING_REFERENCE` rows.
- `wallet_ledger_entries`: `UNIQUE (transaction_id, wallet_id)`, arithmetic `CHECK`, amounts `>= 0` / `> 0`, `UPDATE`/`DELETE` blocked by an append-only trigger, FK to `wager_transactions` **`DEFERRABLE INITIALLY DEFERRED`** (insert order inside the transaction does not matter), index `(wallet_id, created_at desc, id desc)` for pagination.
- `inbox_messages`: `UNIQUE (consumer_name, message_id)`.
- `outbox_messages`: partial index on `next_attempt_at WHERE published_at IS NULL`.
- Reconciliation reads in a `REPEATABLE READ` read-only transaction (single snapshot, no false divergence).

# Observability (OLD_README §12)
- Structured JSON logs with `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`. No sensitive data nor full financial payloads.
- Metrics: transactions by status, detected duplicates (inbox hits and idempotent replays, separately), retries, DLQ messages, lock conflicts, outbox lag (`now() - min(occurred_at)` of unpublished rows), processing latency, `wagering_reconciliation_mismatches_total` (all metrics exposed at `GET /metrics`).
- Separate liveness and readiness health checks.

# Documentation deliverables (OLD_README §14)
- `README.md` (the project's) with setup and commands, including the Swagger URL.
- `ARCHITECTURE.md` with decisions, trade-offs and limitations: ORM choice, `Money` mapping, transaction and concurrency strategy, two aggregates in one transaction, `failureCode` taxonomy, HTTP status mapping, `payloadHash` algorithm, inbox × idempotency key overlap, pending-reference retry limit, outbox lock vs lease, authentication decision, and every item in "Design decisions" below.
- Swagger / OpenAPI at `/docs` (see "API documentation (Swagger)").

# Design decisions already taken
| Decision | Where |
|---|---|
| Money in memory as `bigint` cents; `from` requires exactly 2 decimals and never rounds | @docs/domain/money.md |
| Our ids are `IdValueObject` (16 chars, `char(16)`), external ids are strings | @docs/domain/shared.md |
| Ledger entries are children of `WalletAggregate`; only new entries in memory | @docs/domain/wallet.md |
| Inbox and outbox are aggregates of one in the `src/modules/messaging/` module | @docs/domain/inbox-message.md, @docs/domain/outbox-message.md |
| `observedBalance` stored on the transaction to answer replays with the original balance | @docs/domain/wager-transaction.md |
| `WALLET_NOT_FOUND` is not persisted (no wallet to reference) | @docs/domain/shared.md |
| `422` for business rejection with the transaction result as body; `200` for replay of `PROCESSED` | @docs/routes/submit-wager-transaction.md |
| `balance: null` while `PENDING_REFERENCE` | @docs/routes/submit-wager-transaction.md |
| Ledger keyset pagination with base64url cursor, newest first | @docs/routes/get-wallet-ledger.md |
| Reconciliation always `200`, `REPEATABLE READ` read-only | @docs/routes/reconcile-wallet.md |
| SQS permanent errors that persist nothing go to the DLQ | @docs/routes/submit-wager-transaction.md |
| `/health/ready` returns `503` after `SIGTERM` | @docs/routes/health.md |
| Deposits and withdrawals are internal wager transactions (`DEPOSIT`, `WITHDRAWAL`) decided by the shared processor; the client key is scoped to the wallet | @docs/routes/deposit-to-wallet.md |

# Pending verification
- MikroORM snippets in @docs/files-patterns/ (`EntitySchema`, `em.insert`, `nativeUpdate`, `LockMode`, `em.transactional` options `isolationLevel`/`readOnly`) were written from memory: check them against the installed version.
- `ddd-tool-kit@2.3.0` was checked against the published package; the domain code in @docs/domain/ compiles in strict mode.
