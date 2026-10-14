# POST /wallets — criar carteira

OLD_README §9 ("Criar wallet"). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet.md.

## Papel

Cria a carteira de um jogador em uma moeda. Se o saldo inicial for maior que zero, cria **na mesma transação SQL** uma `WagerTransaction` interna `OPENING` (`PROCESSED`) e o lançamento `CREDIT` correspondente no ledger.

## Request

```http
POST /wallets
Content-Type: application/json
X-Correlation-Id: c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f   (opcional)
```

```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```

| Campo | Regra | Onde é validado |
|---|---|---|
| `playerId` | string não vazia, até 128 caracteres | DTO + `WalletAggregate.open` |
| `initialBalance.amount` | string com exatamente 2 casas, ≥ `0.00` | `MoneyValueObject.from` |
| `initialBalance.currency` | ISO-4217 (`BRL`) | `MoneyValueObject.from` |

`initialBalance` de `"0.00"` é aceito: a carteira nasce sem `OPENING` e sem lançamento.

## Fluxo

```
CreateWalletController
  └─ CreateWalletService.execute(input)
       1. MoneyValueObject.from(initialBalance)              → 400 INVALID_PAYLOAD
       2. walletId = IdValueObject.getDefault()
       3. se saldo > 0: opening = WagerTransactionAggregate.createOpening(...)
       4. WalletAggregate.open({ id: walletId, playerId, initialBalance, openingTransactionId })
       5. uow.transactional:
            wagerTransactionRepository.insert(opening)       (se houver)
            walletRepository.insert(wallet)                  (carteira + lançamento OPENING)
            outbox: WagerTransactionProcessed + WalletBalanceChanged (se saldo > 0)
          COMMIT
            UNIQUE (player_id, currency) violada             → 409 WALLET_ALREADY_EXISTS
       6. WalletDtoMapper → 201
```

A unicidade é garantida **pelo banco**. Não faça "busca se existe e depois insere": duas requisições simultâneas passariam pela busca e uma delas quebraria no `UNIQUE` de qualquer jeito. Trate a violação da constraint e converta em `409`.

## Responses

### 201 Created
```json
{
  "id": "4f1c2a9be07d3e58",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "balance": { "amount": "1000.00", "currency": "BRL" },
  "version": 1
}
```

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | `playerId` vazio, dinheiro mal formatado, moeda inválida, saldo negativo |
| 409 | `WALLET_ALREADY_EXISTS` | já existe carteira para `playerId + currency` |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

Esta rota não tem idempotency key (o OLD_README não pede). Um reenvio depois de timeout recebe `409`, que indica que a carteira já foi criada.

## Arquivos

```
src/presentation/http/wallets/create-wallet.controller.ts
src/presentation/http/wallets/create-wallet.request.dto.ts
src/presentation/http/wallets/wallet.response.dto.ts        (compartilhado com GET /wallets/:walletId)
src/presentation/http/wallets/wallet-dto.mapper.ts
src/application/use-cases/create-wallet/create-wallet.service.ts
src/application/use-cases/create-wallet/create-wallet.input.ts
src/application/use-cases/create-wallet/create-wallet.output.ts
```

### create-wallet.request.dto.ts
```ts
import { Type } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";

class MoneyRequestDto {
  @IsString() amount!: string;   // format checked by MoneyValueObject.from
  @IsString() currency!: string;
}

class CreateWalletRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  playerId!: string;

  @ValidateNested() @Type(() => MoneyRequestDto)
  initialBalance!: MoneyRequestDto;
}

export { CreateWalletRequestDto, MoneyRequestDto };
```

## Testes (integração, PostgreSQL real)

- Saldo inicial `1000.00`: `201`, `version = 1`, existe uma transação `OPENING` `PROCESSED` e um lançamento `CREDIT 0.00 → 1000.00`, e a outbox tem os dois eventos.
- Saldo inicial `0.00`: `201`, nenhuma transação `OPENING`, nenhum lançamento.
- Mesma `playerId + currency` duas vezes: `409 WALLET_ALREADY_EXISTS`.
- Duas criações **simultâneas** para o mesmo jogador: uma `201` e uma `409`, e uma única carteira no banco.
- Mesmo jogador em outra moeda: `201` (são carteiras diferentes).
- `"1000"`, `"-1.00"`, `"10.005"`, moeda `"brl"`: `400 INVALID_PAYLOAD`.
- Reconciliação logo depois da criação: `consistent: true`.
