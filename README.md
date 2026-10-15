# Distributed Wagering Processor

Serviço financeiro que aplica nas carteiras dos jogadores as transações de aposta enviadas por provedores de jogos (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`), por **HTTP** ou por **fila SQS**. Ele mantém o saldo e um **ledger imutável** corretos mesmo quando as mensagens chegam **duplicadas**, **fora de ordem** ou são processadas **ao mesmo tempo** por várias instâncias.

- Enunciado do desafio: [`OLD_README.md`](OLD_README.md)
- Decisões, trade-offs e limitações: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Especificação detalhada (domínio e rotas): [`docs/`](docs/requirements.md)

**Stack:** Bun 1.x · TypeScript strict · NestJS 11 · PostgreSQL 17 · MikroORM 6 · AWS SQS (LocalStack) · Docker Compose · `ddd-tool-kit`.

---

## Subir tudo

Requisito: Docker com Docker Compose (e Bun, para os atalhos `bun run`).

```bash
bun run start      # sobe tudo em segundo plano e espera ficar saudável
bun run destroy    # para tudo e apaga containers, banco (volume), filas e a imagem da app
```

`bun run start` é `docker compose up -d --build --wait`: sobe PostgreSQL, LocalStack (já com as filas criadas) e a aplicação, que aplica as migrations no boot. Nenhum passo manual é necessário. Depois de um `destroy`, o próximo `start` recomeça do zero (banco vazio, filas novas).

| O quê | Onde |
|---|---|
| API | http://localhost:3000 |
| **Documentação (Swagger UI)** | **http://localhost:3000/docs** |
| OpenAPI JSON | http://localhost:3000/docs/json |
| Métricas (Prometheus) | http://localhost:3000/metrics |
| Health | http://localhost:3000/health/live · http://localhost:3000/health/ready |
| PostgreSQL | `localhost:5433` (usuário/senha/banco `wagering`) — 5433 para não colidir com um Postgres local |
| LocalStack (SQS) | `localhost:4566` |

Para só parar sem apagar os dados: `docker compose down`.

## Usar

```bash
# 1. criar uma carteira com saldo inicial (gera OPENING + lançamento CREDIT)
curl -s -X POST localhost:3000/wallets -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'
# → {"id":"<walletId>","playerId":"...","balance":{"amount":"100.00","currency":"BRL"},"version":1}

# 2. apostar (Idempotency-Key é obrigatório)
curl -s -X POST localhost:3000/wagering/transactions -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  -d '{"providerId":"provider-a","externalTransactionId":"transaction-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
       "walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
# → 201 {"transactionId":"...","status":"PROCESSED","balance":{"amount":"75.00","currency":"BRL"},"failureCode":null,"idempotentReplay":false}
# repetir o mesmo comando → 200 com idempotentReplay: true (nada é debitado de novo)

# 3. extrato, consulta e reconciliação
curl -s localhost:3000/wallets/<walletId>/ledger
curl -s localhost:3000/providers/provider-a/wagering/transactions/transaction-123
curl -s -X POST localhost:3000/wallets/<walletId>/reconciliation

# 4. a mesma operação pela fila (assíncrona)
docker compose exec localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id <walletId> --message-deduplication-id msg-1 \
  --message-body '{"messageId":"msg-1","type":"WagerTransactionRequested","occurredAt":"2026-07-29T15:00:00.000Z",
    "data":{"providerId":"provider-a","externalTransactionId":"transaction-124","idempotencyKey":"provider-a:transaction-124",
    "playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp",
    "kind":"WIN","money":{"amount":"50.00","currency":"BRL"}}}'
```

Todos os status, códigos de falha e exemplos estão no **Swagger** (`/docs`).

## Testes

Os testes de integração e concorrência usam **PostgreSQL e LocalStack reais** (os containers do Compose), com um banco (`wagering_test`) e filas (`*-test.fifo`) separados dos da aplicação. Nada é mockado.

```bash
bun install
bun run start               # ou só a infra: docker compose up -d postgres localstack --wait

bun test                    # unitários (domínio e eventos)
bun run test:integration    # API, persistência, mensageria, Swagger e health
bun run test:concurrency    # paralelismo real, 3 processos, SIGKILL + restart
bun run test:all            # os três
bun run typecheck
```

| Exigência (OLD_README §13) | Onde |
|---|---|
| `Money`: escala, entradas inválidas, conflito de moeda | `test/unit/domain/money.value-object.spec.ts` |
| Invariantes da `Wallet`, regras de BET/WIN/LOSS/REFUND/ROLLBACK | `test/unit/domain/*.spec.ts`, `test/integration/api/wager-transactions.spec.ts` |
| Idempotency key com payload divergente | `wager-transactions.spec.ts` (409) e unit `matchesPayload` |
| Migrations e constraints | `test/integration/database/persistence.spec.ts` |
| Atomicidade wallet/ledger/inbox/outbox | `persistence.spec.ts` (rollback de tudo junto) |
| Inbox e redelivery, retry e DLQ | `test/integration/messaging/messaging.spec.ts` |
| Publishers concorrentes na mesma outbox | `messaging.spec.ts` e 3 instâncias em `test/concurrency` |
| Mesma aposta 50× em paralelo → um débito | `test/concurrency/concurrency.spec.ts` (1) |
| 100.00 com duas apostas de 80.00 simultâneas | `concurrency.spec.ts` (2) |
| Wallets distintas em paralelo | `concurrency.spec.ts` (3) |
| ≥ 3 processos simultâneos | `concurrency.spec.ts` (4) — três `bun src/main.ts` reais |
| Worker morto depois do commit e antes do ack | `messaging.spec.ts` e `concurrency.spec.ts` (5/8, `SIGKILL`) |
| `ROLLBACK`/`REFUND` antes da referência | `wager-transactions.spec.ts` e `concurrency.spec.ts` (7) |
| Reinício com consistência final | `concurrency.spec.ts` (5/8) |
| Invariante final `wallet.balance == ledger` | `expectLedgerMatchesBalances` em todos os testes que movem dinheiro |
| Swagger completo (todas as rotas e status, com exemplos) | `test/integration/docs/swagger.spec.ts` |

## Desenvolvimento local (sem o container da app)

```bash
cp .env.example .env
docker compose up -d postgres localstack --wait
bun run migration:up        # bun run migration:down reverte a última
bun run dev                 # watch mode
```

Configuração por variáveis de ambiente (ver `.env.example` e `src/config/app-config.ts`). As principais:

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL` | `postgres://wagering:wagering@localhost:5433/wagering` | conexão |
| `AWS_ENDPOINT_URL` | — | `http://localhost:4566` para LocalStack |
| `LOCK_TIMEOUT_MS` | `5000` | espera máxima pelo lock de uma carteira antes de responder `503` |
| `RUN_HTTP`, `RUN_SQS_CONSUMER`, `RUN_OUTBOX_PUBLISHER`, `RUN_PENDING_REFERENCE_WORKER` | `true` | liga/desliga cada entrada (permite instâncias só de worker) |
| `PENDING_REFERENCE_MAX_ATTEMPTS` | `10` | tentativas antes de `REFERENCE_NOT_FOUND` (~5 min com o backoff padrão) |
| `MIGRATIONS_RUN_ON_BOOT` | `true` | aplica migrations ao subir (serializado por advisory lock entre instâncias) |
| `LOG_LEVEL` | `info` | logs JSON (pino) |

## Estrutura

```
src/
  config/          configuração e composição (MikroORM, lista de schemas)
  shared/          kernel compartilhado: failure codes, erros, unit of work, SQS client, métricas, health, HTTP comum, Swagger
  modules/
    wallet/              carteira, dinheiro (Money) e lançamentos do ledger
    wager-transaction/   BET/WIN/LOSS/REFUND/ROLLBACK: rota HTTP, consumer SQS, worker de pendências
    messaging/           inbox, outbox, eventos de integração e publicação no SQS
      └─ cada módulo: domain/ (aggregate, events, mappers, interfaces, usecases)
                      presentation/ (controllers, consumers, producers)
                      infrastructure/ (database, services = implementações das interfaces)
test/
  unit/  integration/  concurrency/
docs/              requisitos condensados, um arquivo por domínio e por rota
```
