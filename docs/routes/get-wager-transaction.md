# GET /wagering/transactions/:transactionId — consultar transação pelo id interno

OLD_README §9 ("Consultas"). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wager-transaction.md.

## Papel

Devolve uma transação pelo **nosso** id (o `transactionId` que a resposta do `POST /wagering/transactions` devolveu). Serve para auditoria e para acompanhar uma transação `PENDING_REFERENCE` até ela ser decidida.

Para consultar pelo id **do provedor**, use @docs/routes/get-provider-wager-transaction.md. As duas rotas devolvem **o mesmo formato**.

## Request

```http
GET /wagering/transactions/9a7e0c3d51b2f846
```

| Parâmetro | Regra |
|---|---|
| `transactionId` | id de 16 caracteres. Outro formato → `400 INVALID_PAYLOAD` |

## Fluxo

```
GetWagerTransactionController
  └─ GetWagerTransactionService.execute({ transactionId })
       1. IdValueObject.init                              → 400 INVALID_PAYLOAD
       2. wagerTransactionRepository.findById(id)         → 404 TRANSACTION_NOT_FOUND
          (mapper.toRightSide → WagerTransactionAggregate.rehydrate)
       3. WagerTransactionDtoMapper.toRightSide(tx)       → 200
```

Transações internas (`OPENING`) também são encontradas aqui. Elas aparecem no extrato, então precisam ser consultáveis.

## Responses

### 200 OK
```json
{
  "transactionId": "9a7e0c3d51b2f846",
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "walletId": "4f1c2a9be07d3e58",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" },
  "referenceExternalTransactionId": null,
  "referenceTransactionId": null,
  "status": "PROCESSED",
  "failureCode": null,
  "balance": { "amount": "975.00", "currency": "BRL" },
  "processedAt": "2026-07-29T15:00:00.120Z",
  "createdAt": "2026-07-29T15:00:00.100Z"
}
```

- `balance` é o saldo observado quando a transação foi decidida (`observedBalance`). É `null` enquanto estiver `PENDING_REFERENCE`.
- `idempotencyKey` e `payloadHash` **não** são expostos. São detalhes internos da idempotência.
- Campos opcionais ausentes vêm como `null` (não somem do JSON), para o formato ser previsível.

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | `transactionId` com formato inválido |
| 404 | `TRANSACTION_NOT_FOUND` | transação não existe |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

## Arquivos

```
src/modules/wager-transaction/presentation/controllers/get-wager-transaction.controller.ts
src/modules/wager-transaction/presentation/controllers/dtos/wager-transaction.dto.ts   (WagerTransactionDto, compartilhado com a rota por provedor)
src/modules/wager-transaction/presentation/controllers/wager-transaction.examples.ts   (compartilhado)
src/modules/wager-transaction/domain/usecases/get-wager-transaction/get-wager-transaction.usecase.ts
src/modules/wager-transaction/domain/mappers/wager-transaction-view.mapper.ts          (compartilhado)
```

### wager-transaction-dto.mapper.ts
```ts
import { IUnidirectionalMapper } from "ddd-tool-kit";
import { WagerTransactionAggregate } from "../../../domain/wager-transaction/wager-transaction.aggregate-root";
import { WagerTransactionResponseDto } from "./wager-transaction.response.dto";

class WagerTransactionDtoMapper
  implements IUnidirectionalMapper<WagerTransactionAggregate, WagerTransactionResponseDto>
{
  toRightSide(tx: WagerTransactionAggregate): WagerTransactionResponseDto {
    return {
      transactionId: tx.id.value,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId.value,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
      referenceTransactionId: tx.referenceTransactionId?.value ?? null,
      status: tx.status,
      failureCode: tx.failureCode ?? null,
      balance: tx.observedBalance?.toJSON() ?? null,
      processedAt: tx.processedAt?.value.toISOString() ?? null,
      createdAt: tx.createdAt.value.toISOString(),
    };
  }
}

export { WagerTransactionDtoMapper };
```

## Testes (integração)

- `BET` processada: `200` com `status: PROCESSED` e o saldo da época.
- `BET` rejeitada: `200` com `status: REJECTED` e `failureCode`. A **consulta** deu certo; quem foi rejeitada foi a transação.
- `ROLLBACK` pendente: `PENDING_REFERENCE` e `balance: null`. Depois que o worker resolve, vira `PROCESSED` com `referenceTransactionId`.
- Id inexistente: `404`. Id mal formatado: `400`.
