# POST /wallets/:walletId/withdrawals — sacar da carteira

**Extensão: não está no OLD_README.** Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet.md e @docs/domain/wager-transaction.md (kind `WITHDRAWAL`). A rota irmã, com a explicação completa do mecanismo compartilhado, é @docs/routes/deposit-to-wallet.md.

## Papel

Tira dinheiro da carteira, fora de uma rodada de jogo (ex.: o jogador pediu um saque). O saldo **diminui** no valor sacado e o extrato ganha um lançamento de **DÉBITO**.

É o espelho do depósito: uma transação interna de kind `WITHDRAWAL` (provedor `internal`), decidida pelo mesmo `processor.decide()` das apostas, com a mesma idempotência, o mesmo lock da carteira, o mesmo extrato, a mesma outbox e a mesma reconciliação.

## A regra que importa: o saldo nunca fica negativo

Um saque maior que o saldo **não é aplicado**. Ele é gravado como `REJECTED` com `INSUFFICIENT_FUNDS` e respondido com `422`, exatamente como uma `BET` sem saldo:

- o saldo e a `version` não mudam e nenhum lançamento é gravado;
- a tentativa fica no banco (auditável) e gera `WagerTransactionRejected`;
- reenviar o mesmo pedido devolve o mesmo `422` como replay (`idempotentReplay: true`).

Sacar **todo** o saldo é permitido: o saldo vai a exatamente `0.00`.

A garantia vale em concorrência: saques simultâneos na mesma carteira entram em fila pelo `SELECT … FOR UPDATE`, e cada um enxerga o saldo já debitado pelo anterior. Dez saques de `30.00` em paralelo numa carteira com `100.00` resultam em **três** `201`, sete `422` e saldo final `10.00` (teste de integração). O banco também recusa saldo negativo (`CHECK ("balance_amount" >= 0)`).

## Request

```http
POST /wallets/4f1c2a9be07d3e58/withdrawals
Content-Type: application/json
Idempotency-Key: cashier:withdrawal-8842
```

```json
{
  "money": { "amount": "50.00", "currency": "BRL" }
}
```

As regras do corpo, do header e da idempotência são as mesmas do depósito (@docs/routes/deposit-to-wallet.md): valor com 2 casas e maior que zero, mesma moeda da carteira, `Idempotency-Key` obrigatória com escopo na carteira (`internal:{walletId}:{key}`), `externalTransactionId` interno `"withdrawal:{walletId}:{key}"`. Reusar a key de um depósito desta carteira para um saque é `409`.

## Fluxo

Igual ao depósito, com uma diferença no passo de decisão:

```
processor.decide(tx, wallet)
  moeda diferente           → REJECTED CURRENCY_MISMATCH
  wallet.debit(money):
    saldo < valor           → REJECTED INSUFFICIENT_FUNDS   (nada muda, a tentativa é gravada)
    senão                   → lançamento DEBIT → PROCESSED
```

## Responses

### 201 Created
```json
{
  "transactionId": "7c2d9e0b4a1f3e65",
  "status": "PROCESSED",
  "balance": { "amount": "950.00", "currency": "BRL" },
  "failureCode": null,
  "idempotentReplay": false
}
```

### 200 OK (replay)
Mesmo corpo da primeira resposta, com `"idempotentReplay": true`.

### 422 Unprocessable Entity (saldo insuficiente)
```json
{
  "transactionId": "7c2d9e0b4a1f3e65",
  "status": "REJECTED",
  "balance": { "amount": "30.00", "currency": "BRL" },
  "failureCode": "INSUFFICIENT_FUNDS",
  "idempotentReplay": false
}
```
O `balance` é o saldo no momento da decisão (que não mudou). Moeda diferente responde da mesma forma com `CURRENCY_MISMATCH`.

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
| `PROCESSED` | `WagerTransactionProcessed` (kind `WITHDRAWAL`) + `WalletBalanceChanged` (`direction: DEBIT`) |
| `REJECTED` | `WagerTransactionRejected` |

## Arquivos

```
src/modules/wallet/presentation/controllers/withdraw-from-wallet.controller.ts
```

O resto (use case, DTO, documentação do Swagger, factory, migration) é compartilhado com o depósito: veja a lista em @docs/routes/deposit-to-wallet.md.

## Testes

`test/integration/api/wallet-operations.spec.ts`:

- `201`: saldo, linha `WITHDRAWAL`/`PROCESSED`, lançamento `DEBIT` e eventos.
- Sacar todo o saldo deixa `0.00`.
- Saque acima do saldo: `422 INSUFFICIENT_FUNDS`, linha `REJECTED` gravada, nenhum lançamento, só `WagerTransactionRejected`, saldo intacto; reenvio devolve o mesmo `422` como replay.
- Replay `200` com o saldo daquele momento; `409` com outro valor ou com a key de um depósito.
- `400` para cada entrada inválida (sem key, inteiro, 1 ou 3 casas, negativo, zero).
- 10 saques de `30.00` em paralelo sobre `100.00`: exatamente 3 passam, saldo final `10.00`, extrato consistente.
- Provedor tentando `WITHDRAWAL` por `/wagering/transactions` → `400`.
