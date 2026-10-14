# POST /wallets/:walletId/reconciliation — reconciliar carteira

OLD_README §9 ("Reconciliação") e §13 (invariante final). Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wallet.md e @docs/domain/wallet-ledger-entry.md.

## Papel

Confere se o saldo **materializado** da carteira (`wallets.balance_amount`) é igual ao saldo **reconstruído pelo ledger** (créditos − débitos). É a prova de que as duas fontes concordam e é a mesma invariante que todo teste precisa verificar no final.

Divergência **não é corrigida automaticamente**: ela é logada, contada em métrica e sinalizada na resposta.

## Request

```http
POST /wallets/4f1c2a9be07d3e58/reconciliation
```

Sem body. É `POST` porque executa uma verificação com efeitos colaterais (log e métrica), e não uma leitura simples.

## Cálculo

```sql
select
  coalesce(sum(case when "direction" = 'CREDIT' then "amount" else -"amount" end), 0) as "calculated",
  count(*) as "checked_entries"
from "wallet_ledger_entries"
where "wallet_id" = $1;
```

O resultado vem como string (`numeric`) e é convertido com `MoneyValueObject.from`. A diferença é `stored.subtract(calculated)`, que pode ser negativa: o `MoneyValueObject` aceita negativos internamente (@docs/domain/money.md).

### Leitura consistente

O saldo e a soma do ledger precisam ser lidos **do mesmo instante**. Se um débito comitar entre as duas leituras, a reconciliação acusaria uma divergência falsa. Por isso as duas consultas rodam numa transação **`REPEATABLE READ` somente leitura**: o PostgreSQL entrega um snapshot único para a transação inteira, sem bloquear as apostas que estão acontecendo.

```ts
await this.uow.transactional(async () => {
  const wallet = await this.walletRepository.findById(walletId);
  const ledger = await this.ledgerReconciliationQuery.sum(walletId);
  // ...
}, { isolation: "REPEATABLE READ", readOnly: true });
```

(O `UnitOfWork` precisa aceitar essas opções, repassando para `em.transactional(cb, { isolationLevel, readOnly })` do MikroORM.)

### Verificação extra (opcional)

Além da soma, dá para conferir o **encadeamento**: o `balance_before` de cada lançamento é igual ao `balance_after` do anterior. Isso detecta lançamentos fora de ordem ou faltando, mesmo quando a soma bate por coincidência. Se implementar, devolva em um campo à parte (ex.: `chainBroken: false`) para não mudar o contrato do OLD_README.

## Fluxo

```
ReconcileWalletController
  └─ ReconcileWalletService.execute({ walletId, correlationId })
       1. IdValueObject.init                                  → 400 INVALID_PAYLOAD
       2. transação REPEATABLE READ, read only:
            walletRepository.findById                         → 404 WALLET_NOT_FOUND
            ledgerReconciliationQuery.sum(walletId)
       3. difference = stored − calculated; consistent = difference.isZero()
       4. se !consistent:
            log de erro (walletId, stored, calculated, difference, correlationId)
            métrica wagering_reconciliation_mismatches_total{currency} +1
       5. 200 (sempre, consistente ou não)
```

## Responses

### 200 OK (consistente)
```json
{
  "walletId": "4f1c2a9be07d3e58",
  "storedBalance":     { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference":        { "amount": "0.00",   "currency": "BRL" },
  "consistent": true,
  "checkedEntries": 42
}
```

### 200 OK (divergente)
```json
{
  "walletId": "4f1c2a9be07d3e58",
  "storedBalance":     { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "1000.00", "currency": "BRL" },
  "difference":        { "amount": "-25.00", "currency": "BRL" },
  "consistent": false,
  "checkedEntries": 41
}
```

A divergência é um **resultado** da verificação, não um erro da requisição, por isso o status continua `200`. O campo `consistent` e a métrica sinalizam o problema.

### Erros

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | `walletId` com formato inválido |
| 404 | `WALLET_NOT_FOUND` | carteira não existe |
| 503 | `TRANSIENT_FAILURE` | banco indisponível |

## Arquivos

```
src/modules/wallet/presentation/controllers/reconcile-wallet.controller.ts
src/modules/wallet/presentation/controllers/dtos/reconciliation.dto.ts
src/modules/wallet/domain/usecases/reconcile-wallet/reconcile-wallet.usecase.ts
src/modules/wallet/domain/services/ledger-reconciliation.query.ts            ← porta (interface)
src/modules/wallet/infrastructure/database/queries/mikro-orm.ledger-reconciliation.query.ts
```

## Testes (integração)

- Depois de abertura, apostas, ganhos, perdas, refunds e rollbacks: `consistent: true`, e `checkedEntries` igual ao número de lançamentos.
- Divergência forçada (alterar `wallets.balance_amount` direto no banco dentro do teste; só a tabela do ledger tem trigger append-only): `consistent: false`, `difference` correta, e a métrica incrementada.
- Reconciliação rodando **em paralelo** com apostas na mesma carteira: nunca acusa divergência falsa.
- Carteira com saldo inicial zero e sem movimento: `0.00 = 0.00`, `checkedEntries: 0`.
