# GET /providers/:providerId/wagering/transactions/:externalTransactionId — consultar transação pelo id do provedor

OLD_README §9 ("Consultas"). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wager-transaction.md.

## Papel

Devolve uma transação pelo id **do provedor** (`externalTransactionId`). É a forma natural de o provedor perguntar "o que aconteceu com a minha `transaction-123`?" sem conhecer o nosso id interno. É especialmente útil quando ele enviou pela **fila**, onde não recebe resposta.

O formato da resposta é **igual** ao de @docs/routes/get-wager-transaction.md.

## Request

```http
GET /providers/provider-a/wagering/transactions/transaction-123
```

| Parâmetro | Regra |
|---|---|
| `providerId` | string não vazia, até 128 caracteres |
| `externalTransactionId` | string não vazia, até 128 caracteres. Use `encodeURIComponent` no cliente se tiver caracteres especiais |

A busca usa o par `(providerId, externalTransactionId)`, que é único no banco (`UNIQUE (provider_id, external_transaction_id)`). Dois provedores podem usar o mesmo `externalTransactionId` sem conflito.

## Fluxo

```
GetProviderWagerTransactionController
  └─ GetProviderWagerTransactionService.execute({ providerId, externalTransactionId })
       1. valida os dois parâmetros                               → 400 INVALID_PAYLOAD
       2. wagerTransactionRepository.findByExternalId(providerId, externalTransactionId)
                                                                  → 404 TRANSACTION_NOT_FOUND
       3. WagerTransactionDtoMapper.toRightSide(tx)               → 200
```

O mesmo método `findByExternalId` do repository é usado pelo `SubmitWagerTransactionService` para resolver referências de `REFUND`/`ROLLBACK`.

## Uso típico pelo provedor

1. Envia a `BET` pela fila.
2. Consulta `GET /providers/provider-a/wagering/transactions/transaction-123`:
   - `404` → ainda não processada (ou nunca chegou). Tenta de novo depois.
   - `200` com `PROCESSED`/`REJECTED` → resultado definitivo.
   - `200` com `PENDING_REFERENCE` → aguardando a referência. Tenta de novo depois.

## Responses

### 200 OK

Mesmo corpo de @docs/routes/get-wager-transaction.md.

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | parâmetro vazio ou longo demais |
| 404 | `TRANSACTION_NOT_FOUND` | não existe transação com esse par |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

## Arquivos

```
src/modules/wager-transaction/presentation/controllers/get-provider-wager-transaction.controller.ts
src/modules/wager-transaction/presentation/controllers/dtos/wager-transaction.dto.ts   (compartilhado)
src/modules/wager-transaction/domain/usecases/get-provider-wager-transaction/get-provider-wager-transaction.usecase.ts
src/modules/wager-transaction/domain/mappers/wager-transaction-view.mapper.ts          (compartilhado)
```

O controller fica com `@Controller("providers")` e `@Get(":providerId/wagering/transactions/:externalTransactionId")`.

## Testes (integração)

- Transação enviada por HTTP e consultada por aqui: mesmo corpo da consulta por id interno.
- Transação enviada **pela fila**: depois do processamento, `200` com o resultado.
- `provider-a` e `provider-b` com o mesmo `externalTransactionId`: cada consulta devolve a transação certa.
- Par inexistente: `404`.
