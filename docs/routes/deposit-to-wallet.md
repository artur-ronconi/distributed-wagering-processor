# POST /wallets/:walletId/deposits — depositar na carteira

**Extensão: não está no OLD_README.** Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet.md e @docs/domain/wager-transaction.md (kind `DEPOSIT`). A rota irmã é @docs/routes/withdraw-from-wallet.md.

## Papel

Coloca dinheiro na carteira, fora de uma rodada de jogo (ex.: o caixa do cassino recebeu um Pix). O saldo **aumenta** no valor depositado e o extrato ganha um lançamento de **CRÉDITO**.

O depósito é gravado como uma transação **interna** de kind `DEPOSIT` (provedor `internal`), do mesmo jeito que a abertura de carteira (`OPENING`). Por isso ele herda, sem código novo, todas as garantias das apostas:

- **idempotência persistente**: `Idempotency-Key` obrigatória, replay devolve o resultado original;
- **lock da carteira** (`SELECT … FOR UPDATE`) e `UPDATE` condicionado por `version`;
- **extrato imutável**: um lançamento `CREDIT` com saldo antes e depois;
- **outbox** na mesma transação SQL: `WagerTransactionProcessed` + `WalletBalanceChanged`;
- **reconciliação** continua batendo (o lançamento entra na soma).

## Request

```http
POST /wallets/4f1c2a9be07d3e58/deposits
Content-Type: application/json
Idempotency-Key: cashier:deposit-8841
```

```json
{
  "money": { "amount": "50.00", "currency": "BRL" }
}
```

| Campo | Regra |
|---|---|
| `walletId` (path) | id de 16 caracteres devolvido por `POST /wallets` |
| `Idempotency-Key` (header) | **obrigatório**, 1 a 256 caracteres. Vale **dentro desta carteira** |
| `money.amount` | string com **exatamente 2 casas**, **maior que zero** |
| `money.currency` | mesma moeda da carteira; outra moeda é rejeitada (`422 CURRENCY_MISMATCH`) |

## Idempotência

A key do cliente é guardada com escopo na carteira: `idempotency_key = "internal:{walletId}:{key}"`. O `externalTransactionId` interno é `"deposit:{walletId}:{key}"`.

| Situação | Resultado |
|---|---|
| Mesma key + mesmo corpo | `200`, `idempotentReplay: true`, **mesmo `transactionId` e saldo daquele momento**. Nada é creditado de novo |
| Mesma key + outro valor | `409 IDEMPOTENCY_CONFLICT`, nada gravado |
| Mesma key usada antes num **saque** desta carteira | `409 IDEMPOTENCY_CONFLICT` (o hash inclui a operação) |
| Mesma key em **outra** carteira | operação independente (`201`) |

O `payloadHash` é o SHA-256 do JSON canônico de `{ walletId, operation: "DEPOSIT", money }`.

## Fluxo

```
DepositToWalletController
  └─ MoveWalletFundsUseCase.execute({ walletId, operation: DEPOSIT, money, idempotencyKey, correlationId })
       1. validação pura (nenhuma transação aberta):
            Idempotency-Key presente (1–256)                  → 400 INVALID_PAYLOAD
            IdValueObject.init(walletId)                      → 400 INVALID_PAYLOAD
            MoneyValueObject.from(money)                      → 400 INVALID_PAYLOAD
            money > 0                                         → 400 INVALID_AMOUNT
            payloadHash
       2. uow.transactional:
            findByIdempotencyKey("internal:{walletId}:{key}")  → replay 200 | 409
            wallets.findByIdForUpdate(walletId)               → 404 WALLET_NOT_FOUND
            findByIdempotencyKey de novo (alguém gravou enquanto esperávamos o lock?)
            WagerTransactionAggregate.createWalletOperation(DEPOSIT)   (nasce PENDING)
            processor.decide(tx, wallet)                       (mesmas regras das apostas)
              moeda diferente → REJECTED CURRENCY_MISMATCH
              senão          → wallet.credit → lançamento CREDIT → PROCESSED
            INSERT wager_transactions
            UPDATE wallets … WHERE version = esperada + INSERT wallet_ledger_entries   (se processado)
            INSERT outbox_messages
          COMMIT
       3. DuplicateKeyError/ConcurrencyConflictError (mesmo pedido em paralelo) → nova tentativa (até 3) → replay
```

## Responses

O corpo é o mesmo resultado de `POST /wagering/transactions` (`WagerTransactionResultDto`), e o status sai do mesmo `statusFor`.

### 201 Created
```json
{
  "transactionId": "7c2d9e0b4a1f3e65",
  "status": "PROCESSED",
  "balance": { "amount": "1050.00", "currency": "BRL" },
  "failureCode": null,
  "idempotentReplay": false
}
```

### 200 OK (replay)
Mesmo corpo do `201`, com `"idempotentReplay": true`. O `balance` é o daquele momento, não o atual.

### 422 Unprocessable Entity (moeda diferente)
```json
{
  "transactionId": "7c2d9e0b4a1f3e65",
  "status": "REJECTED",
  "balance": { "amount": "1000.00", "currency": "BRL" },
  "failureCode": "CURRENCY_MISMATCH",
  "idempotentReplay": false
}
```
A rejeição fica gravada (auditável) e gera `WagerTransactionRejected`. O saldo não muda.

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | sem `Idempotency-Key`, `walletId` malformado, corpo sem `money`, valor sem 2 casas ou negativo |
| 400 | `INVALID_AMOUNT` | valor `0.00` |
| 404 | `WALLET_NOT_FOUND` | carteira não existe |
| 409 | `IDEMPOTENCY_CONFLICT` | mesma key com outro corpo ou com a outra operação |
| 503 | `TRANSIENT_FAILURE` | lock da carteira demorou mais que `LOCK_TIMEOUT_MS` ou banco fora (`Retry-After`) |
| 500 | `INTERNAL_ERROR` | erro inesperado; seguro reenviar com a mesma key |

## Eventos

| Desfecho | Eventos na outbox |
|---|---|
| `PROCESSED` | `WagerTransactionProcessed` (kind `DEPOSIT`) + `WalletBalanceChanged` (`direction: CREDIT`) |
| `REJECTED` | `WagerTransactionRejected` |

## Provedores não depositam

`POST /wagering/transactions` (e a fila) recusa `kind: "DEPOSIT"` com `400 INVALID_PAYLOAD`: o `create` dos provedores só aceita `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. O banco reforça com a constraint `wager_tx_internal_kinds_internal_provider` (kinds internos só com `provider_id = 'internal'`).

## Arquivos

```
src/modules/wallet/presentation/controllers/deposit-to-wallet.controller.ts
src/modules/wallet/presentation/controllers/wallet-operation.docs.ts             (Swagger das duas rotas)
src/modules/wallet/presentation/controllers/dtos/wallet-operation.dto.ts          (WalletOperationRequestDto)
src/modules/wallet/domain/usecases/move-wallet-funds/move-wallet-funds.usecase.ts (depósito e saque)
src/modules/wallet/domain/usecases/move-wallet-funds/move-wallet-funds.input.ts
src/modules/wallet/domain/usecases/move-wallet-funds/move-wallet-funds.errors.ts
src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.aggregate-root.ts   (createWalletOperation)
src/modules/wager-transaction/presentation/controllers/transaction-result-status.ts                (statusFor)
src/shared/infrastructure/database/migrations/Migration20261015120000WalletOperations.ts
```

## Testes

`test/integration/api/wallet-operations.spec.ts` (PostgreSQL e LocalStack reais):

- `201`: saldo, `version`, linha `DEPOSIT`/`PROCESSED` com provedor `internal` e key com escopo, lançamento `CREDIT`, eventos e reconciliação consistente.
- Depósito numa carteira vazia (sem `OPENING`).
- Visível em `GET /wagering/transactions/:id` e `GET /providers/internal/wagering/transactions/deposit:{walletId}:{key}`.
- Replay `200` com o saldo daquele momento; `409` com outro valor ou com a key de um saque; mesma key em outra carteira vira outra operação.
- `422 CURRENCY_MISMATCH` sem mexer no saldo; `400` para cada entrada inválida; `404` para carteira inexistente.
- O mesmo depósito 10× em paralelo credita **uma** vez (um `201`, nove `200`).
- Provedor tentando `DEPOSIT` por `/wagering/transactions` → `400`.

Unitários em `test/unit/domain/wager-transaction.aggregate-root.spec.ts` (`createWalletOperation`) e o teste da constraint e da migration em `test/integration/database/persistence.spec.ts`.
