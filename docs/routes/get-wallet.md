# GET /wallets/:walletId — consultar carteira

OLD_README §9 ("Consultas"). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet.md.

## Papel

Devolve a carteira com o saldo **materializado** (a coluna `balance_amount`, sem somar o ledger) e a `version` atual.

## Request

```http
GET /wallets/4f1c2a9be07d3e58
```

| Parâmetro | Regra |
|---|---|
| `walletId` | id de 16 caracteres (`IdValueObject.init`). Outro formato → `400 INVALID_PAYLOAD` |

## Fluxo

Segue o fluxo GET de @docs/files-patterns/repository.md, sem transação nem lock:

```
GetWalletController
  └─ GetWalletService.execute({ walletId })
       1. IdValueObject.init(walletId)                → 400 INVALID_PAYLOAD
       2. walletRepository.findById(id)               → 404 WALLET_NOT_FOUND
          (mapper.toRightSide → WalletAggregate.rehydrate)
       3. WalletDtoMapper.toRightSide(wallet)         → 200
```

Leitura sem lock pode ver o saldo de um instante antes de um débito em andamento. Isso é esperado: a leitura mostra o último estado **confirmado**.

## Responses

### 200 OK
```json
{
  "id": "4f1c2a9be07d3e58",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "version": 2
}
```

Mesmo formato da resposta de `POST /wallets` (`wallet.response.dto.ts` compartilhado).

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | `walletId` com formato inválido |
| 404 | `WALLET_NOT_FOUND` | carteira não existe |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

## Arquivos

```
src/presentation/http/wallets/get-wallet.controller.ts
src/presentation/http/wallets/wallet.response.dto.ts
src/presentation/http/wallets/wallet-dto.mapper.ts
src/application/use-cases/get-wallet/get-wallet.service.ts
src/application/use-cases/get-wallet/get-wallet.input.ts
src/application/use-cases/get-wallet/get-wallet.output.ts
```

### wallet-dto.mapper.ts
```ts
import { IUnidirectionalMapper } from "ddd-tool-kit";
import { WalletAggregate } from "../../../domain/wallet/wallet.aggregate-root";
import { WalletResponseDto } from "./wallet.response.dto";

class WalletDtoMapper implements IUnidirectionalMapper<WalletAggregate, WalletResponseDto> {
  toRightSide(leftSide: WalletAggregate): WalletResponseDto {
    return {
      id: leftSide.id.value,
      playerId: leftSide.playerId,
      balance: leftSide.balance.toJSON(),
      version: leftSide.version,
    };
  }
}

export { WalletDtoMapper };
```

## Testes (integração)

- Depois de criar com `1000.00` e apostar `25.00`: `200`, saldo `975.00`, `version 2`.
- Depois de um `LOSS`: saldo e `version` iguais aos de antes.
- Id inexistente: `404`. Id mal formatado: `400`.
