# GET /wallets/:walletId/ledger — extrato da carteira

OLD_README §9 ("Consultas"). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet-ledger-entry.md.

## Papel

Lista os lançamentos do ledger da carteira, paginados com **cursor estável e opaco**. É a prova auditável de cada mudança de saldo.

É uma **consulta de leitura** (read side): não carrega o `WalletAggregate`, porque o aggregate nunca guarda o histórico (@docs/domain/wallet.md). A query vai direto ao banco e devolve DTOs.

## Request

```http
GET /wallets/4f1c2a9be07d3e58/ledger?limit=50
GET /wallets/4f1c2a9be07d3e58/ledger?cursor=eyJjIjoiMjAyNi0wNy0yOVQxNTowMDowMC4wMDBaIiwiaSI6IjlhN2UwYzNkNTFiMmY4NDYifQ&limit=50
```

| Parâmetro | Regra |
|---|---|
| `walletId` | id de 16 caracteres |
| `limit` | inteiro de 1 a 200. Padrão `50`. Fora disso → `400 INVALID_PAYLOAD` |
| `cursor` | opcional. Valor de `nextCursor` da página anterior. Inválido → `400 INVALID_PAYLOAD` |

## Paginação por cursor

- **Ordem:** do mais recente para o mais antigo, por `(created_at desc, id desc)`. O `id` desempata lançamentos com o mesmo `created_at`.
- **Keyset pagination**, não `OFFSET`. Com `OFFSET`, um lançamento novo entre uma página e outra empurra os itens e gera repetição. Com keyset, a próxima página começa exatamente depois do último item visto:

```sql
select *
from "wallet_ledger_entries"
where "wallet_id" = $1
  and ("created_at", "id") < ($2, $3)      -- só quando há cursor
order by "created_at" desc, "id" desc
limit $4 + 1;                               -- 1 a mais para saber se existe próxima página
```

- **Cursor opaco:** `base64url` de `{"c": "<createdAt ISO>", "i": "<id>"}`. O cliente não deve interpretar o conteúdo. Ele só devolve o valor recebido.
- **Estável:** como o ledger é append-only (nunca muda nem apaga linhas), o mesmo cursor sempre leva à mesma página. Lançamentos novos só aparecem na primeira página.
- Índice: `create index on "wallet_ledger_entries" ("wallet_id", "created_at" desc, "id" desc);`

## Fluxo

```
GetWalletLedgerController
  └─ GetWalletLedgerService.execute({ walletId, cursor, limit })
       1. valida walletId, limit e decodifica o cursor   → 400 INVALID_PAYLOAD
       2. walletRepository.findById (ou exists)          → 404 WALLET_NOT_FOUND
       3. ledgerQuery.page(walletId, cursor, limit + 1)  (read side, sem aggregate)
       4. se veio limit + 1 linhas: nextCursor = cursor do último item da página
       5. 200
```

## Responses

### 200 OK
```json
{
  "items": [
    {
      "id": "b81f04c7e2a9d365",
      "transactionId": "9a7e0c3d51b2f846",
      "direction": "DEBIT",
      "money": { "amount": "25.00", "currency": "BRL" },
      "balanceBefore": { "amount": "1000.00", "currency": "BRL" },
      "balanceAfter": { "amount": "975.00", "currency": "BRL" },
      "createdAt": "2026-07-29T15:00:00.000Z"
    },
    {
      "id": "0e6d5c4b3a291f87",
      "transactionId": "7c3b2a1f0e9d8c76",
      "direction": "CREDIT",
      "money": { "amount": "1000.00", "currency": "BRL" },
      "balanceBefore": { "amount": "0.00", "currency": "BRL" },
      "balanceAfter": { "amount": "1000.00", "currency": "BRL" },
      "createdAt": "2026-07-29T14:59:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`nextCursor: null` significa que não há mais páginas.

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | `walletId`, `limit` ou `cursor` inválidos |
| 404 | `WALLET_NOT_FOUND` | carteira não existe |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

## Arquivos

```
src/modules/wallet/presentation/controllers/get-wallet-ledger.controller.ts
src/modules/wallet/presentation/controllers/dtos/ledger.dto.ts
src/modules/wallet/domain/usecases/get-wallet-ledger/get-wallet-ledger.usecase.ts
src/modules/wallet/domain/usecases/get-wallet-ledger/ledger-cursor.ts        ← encode/decode do cursor
src/modules/wallet/domain/services/wallet-ledger.query.ts                    ← porta de leitura (interface)
src/modules/wallet/infrastructure/database/queries/mikro-orm.wallet-ledger.query.ts
```

### wallet-ledger.query.ts (porta)
```ts
import { MoneyProps } from "../../domain/money/money.props";
import { LedgerDirection } from "../../domain/wallet-ledger-entry/wallet-ledger-entry.props";

interface LedgerCursor {
  createdAt: Date;
  id: string;
}

interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

interface WalletLedgerQuery {
  /** Newest first. Returns up to `limit` items. */
  page(walletId: string, after: LedgerCursor | null, limit: number): Promise<LedgerEntryView[]>;
}

export { LedgerCursor, LedgerEntryView, WalletLedgerQuery };
```

## Testes (integração)

- Carteira com 120 lançamentos, `limit=50`: 3 páginas (50, 50, 20), sem repetição e sem buraco. A última tem `nextCursor: null`.
- Lançamento novo inserido entre a página 1 e a 2: a página 2 continua igual (cursor estável).
- `limit=0`, `limit=201`, `cursor=lixo`: `400`.
- Carteira sem lançamentos (saldo inicial zero): `items: []`, `nextCursor: null`.
