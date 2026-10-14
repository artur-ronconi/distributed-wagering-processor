# Domínio — convenções compartilhadas

Base: `ddd-tool-kit@2.3.0`. O `OLD_README.md` é a fonte da verdade.

## Arquivos de domínio

| Arquivo | Classe | Tipo |
|---|---|---|
| @docs/domain/money.md | `MoneyValueObject` | Value Object |
| @docs/domain/wallet.md | `WalletAggregate` | Aggregate Root (contém os lançamentos) |
| @docs/domain/wallet-ledger-entry.md | `WalletLedgerEntryEntity` | Entity imutável, **filha da Wallet** |
| @docs/domain/wager-transaction.md | `WagerTransactionAggregate` | Aggregate Root com ciclo de vida |
| @docs/domain/inbox-message.md | `InboxMessageAggregate` | Aggregate de um só (mensageria) |
| @docs/domain/outbox-message.md | `OutboxMessageAggregate` | Aggregate de um só (mensageria) |
| @docs/domain/integration-event.md | `IntegrationEvent` + 4 eventos | base em `modules/messaging/domain/events`, eventos em `domain/events` de cada módulo |

## Estrutura de pastas

```
src/
  config/                       app-config.ts, mikro-orm.config.ts, entity-schemas.ts (composição)
  shared/
    domain/                     domain-error.ts, failure-code.ts
    errors/                     erros de aplicação (transient, duplicate key, concurrency) e service-failure
    services/                   interfaces: unit-of-work, metrics, service
    utils/                      canonical-hash.ts (JSON canônico + SHA-256)
    infrastructure/             database (unit of work, migrations, tradução de erros), services (prometheus, sqs client, health)
    presentation/               http (filtro, guard, pipe, correlation id), controllers (health, metrics), swagger
  modules/
    wallet/                     money e wallet-ledger-entry ficam dentro do domínio da wallet
      domain/
        aggregate/
          aggregate-root/       wallet.aggregate-root.ts, .props.ts, .errors.ts
          entities/             wallet-ledger-entry/ (entity, props, errors)
          value-objects/        money/ (value-object, props, errors)
        events/                 wallet-balance-changed.event.ts
        mappers/                wallet-view.mapper.ts (aggregate → resposta)
        services/               só interfaces: wallet.repository.ts, wallet-ledger.query.ts, ledger-reconciliation.query.ts
        usecases/               create-wallet/, get-wallet/, get-wallet-ledger/, reconcile-wallet/
      presentation/controllers/ controllers HTTP + dtos/
      infrastructure/database/  schemas/, mappers/ (linha ⇄ aggregate), repositories/, queries/
    wager-transaction/
      domain/
        aggregate/aggregate-root/  wager-transaction.aggregate-root.ts, .enums.ts, .props.ts, .errors.ts
        events/                    wager-transaction-processed/rejected/pending-reference.event.ts
        mappers/                   wager-transaction-view.mapper.ts
        services/                  wager-transaction.repository.ts (interface)
        usecases/                  submit-wager-transaction/, process-wager-transaction/ (processor), get-*, resolve-pending-references/
      presentation/
        controllers/               HTTP + dtos/
        consumers/                 wager-transactions.consumer.ts (SQS), pending-reference.consumer.ts
      infrastructure/database/     schemas/, mappers/, repositories/
    messaging/                     mecanismos técnicos: inbox, outbox e eventos de integração
      domain/
        aggregate/aggregate-root/  inbox-message/, outbox-message/ (+ outbox-event.interface.ts)
        events/                    integration-event.ts (classe abstrata base dos eventos)
        services/                  interfaces: inbox/outbox repositories, event-publisher
        usecases/                  publish-outbox/
      presentation/producers/      outbox-publisher.producer.ts
      infrastructure/              database/ (schemas, mappers, repositories), services/ (sqs-event.publisher.ts)
```

Os mappers de **visão** (aggregate → resposta) ficam em `domain/mappers`. Os mappers do **banco** (linha do MikroORM ⇄ aggregate) ficam em `infrastructure/database/mappers`, porque dependem do formato das tabelas.

Cada módulo é um módulo Nest (`wallet.module.ts`, `wager-transaction.module.ts`, `messaging.module.ts`). O `SharedModule` é global.

## Aggregates e repositories

Regra do DDD seguida aqui: **só aggregate root tem repository**. Entidades filhas são salvas **através** do root.

| Aggregate | Contém | Repository |
|---|---|---|
| `WalletAggregate` | `WalletLedgerEntryEntity` (só os lançamentos novos ficam em memória) | `WalletRepository` (salva a carteira + insere os lançamentos novos) |
| `WagerTransactionAggregate` | só o root | `WagerTransactionRepository` |
| `InboxMessageAggregate` | só o root | `InboxMessageRepository` |
| `OutboxMessageAggregate` | só o root | `OutboxMessageRepository` |

- Aggregates se referenciam **por id** (`WagerTransaction.walletId`), nunca por objeto.
- Leituras que não mudam estado (extrato paginado, reconciliação) são consultas diretas que devolvem DTOs. Não passam por aggregate.
- **Trade-off a documentar:** o DDD recomenda modificar um aggregate por transação. Aqui uma transação SQL salva `Wallet` + `WagerTransaction` + inbox + outbox, porque o OLD_README (§6.5 e §11) exige atomicidade.

## Como o `ddd-tool-kit` funciona (o que importa para estes arquivos)

- `Domain<T>` guarda `protected readonly props: T`. A **referência** é readonly, mas os campos de `props` podem ser alterados. Por isso a imutabilidade do ledger é garantida com `Object.freeze` (ver @docs/domain/wallet-ledger-entry.md).
- O construtor de `Domain` chama `sanitizeProps()` automaticamente. Não chame de novo.
- `Entity` cria um `id` (`IdValueObject.getDefault()`) quando `props.id` não vem.
- `Aggregate` também cria `createdAt` e `updatedAt` (`DateValueObject.getDefault()`) quando não vêm.
- `IdValueObject` só aceita ids de **16 caracteres** (gerados pela lib `uid`). **Não aceita UUID.** Então:
  - ids **nossos** (wallet, transação, lançamento, evento, inbox, outbox) usam `IdValueObject` e ficam em colunas `char(16)`;
  - ids **externos** (`playerId`, `providerId`, `externalTransactionId`, `roundId`, `gameId`, `messageId`, `idempotencyKey`) são `string`, porque chegam de fora em qualquer formato (o `playerId` do OLD_README é UUID).
- `verifyAllPropsExists(props, this)` testa `!!this[prop]`, ou seja, **os getters**. Todo campo listado precisa de getter, e valores falsy (`0`, `""`, `false`) reprovam. Nunca liste ali campos que podem valer `0` (ex.: `attempts`).
- `verifyAreValueObjects(props, this)` testa `instanceof ValueObject` do toolkit. O `MoneyValueObject` estende `ValueObject`, então passa.
- `DateValueObject.addDays()` **altera** a instância. Não use em datas guardadas em entidades: crie uma nova com `DateValueObject.init({ value: new Date(...) })`.
- `Output.fail(error: IError)` e `Output.success(result)`. `throwFailOutput(output)` repassa a falha de outro `Output`.

## Factories (OLD_README §6.0)

| Factory | Quando usar | Valida? | Retorno |
|---|---|---|---|
| `create` / `open` / `receive` / `enqueue` / `from` | criar algo novo a partir de uma entrada | sim | `Output` |
| `rehydrate` | o mapper reconstruindo o que já está no banco | **não** revalida transições | a instância |

O construtor é sempre `private`.

## Erros: `IDomainError` e `failureCode`

O `IError` do toolkit tem só `message` e `statusCode`. O OLD_README §7.2 exige um `failureCode` estável e legível por máquina, então todo erro do projeto estende o `IError` com `code`:

### shared/domain-error.ts
```ts
import { IError } from "ddd-tool-kit";
import { FailureCode } from "./failure-code";

interface IDomainError extends IError {
  code: FailureCode;
}

export { IDomainError };
```

Para ler o código de uma falha: `(output.result as IDomainError).code`.

### shared/failure-code.ts
```ts
enum FailureCode {
  InvalidPayload = "INVALID_PAYLOAD",
  IdempotencyConflict = "IDEMPOTENCY_CONFLICT",
  WalletAlreadyExists = "WALLET_ALREADY_EXISTS",
  WalletNotFound = "WALLET_NOT_FOUND",
  TransactionNotFound = "TRANSACTION_NOT_FOUND",
  WalletPlayerMismatch = "WALLET_PLAYER_MISMATCH",
  CurrencyMismatch = "CURRENCY_MISMATCH",
  InvalidAmount = "INVALID_AMOUNT",
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ReversalWouldOverdraw = "REVERSAL_WOULD_OVERDRAW",
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceKindNotAllowed = "REFERENCE_KIND_NOT_ALLOWED",
  ReferenceMismatch = "REFERENCE_MISMATCH",
  ReferenceAmountMismatch = "REFERENCE_AMOUNT_MISMATCH",
  ReferenceNotProcessed = "REFERENCE_NOT_PROCESSED",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  TransientFailure = "TRANSIENT_FAILURE",
  InternalError = "INTERNAL_ERROR",
}

export { FailureCode };
```

### Taxonomia (documentar também no `ARCHITECTURE.md`)

| `code` | HTTP | Grava `WagerTransaction`? | O que o provedor faz |
|---|---|---|---|
| `INVALID_PAYLOAD` | 400 | não | corrige o payload |
| `IDEMPOTENCY_CONFLICT` | 409 | não | não reenvia igual. Usa outra key se for outra operação |
| `WALLET_ALREADY_EXISTS` | 409 | — | não recria |
| `WALLET_NOT_FOUND` | 404 | não (não há wallet para referenciar) | corrige o `walletId` |
| `TRANSACTION_NOT_FOUND` | 404 | — (consulta) | corrige o id |
| `WALLET_PLAYER_MISMATCH` | 422 | sim, `REJECTED` | desiste |
| `CURRENCY_MISMATCH` | 422 | sim, `REJECTED` | desiste |
| `INVALID_AMOUNT` | 400 | não | corrige o valor |
| `INSUFFICIENT_FUNDS` | 422 | sim, `REJECTED` | desiste |
| `REVERSAL_WOULD_OVERDRAW` | 422 | sim, `REJECTED` | operação manual |
| `REFERENCE_NOT_FOUND` | 422 (depois do limite de retry) | sim, `REJECTED` | verifica se a referência foi enviada |
| `REFERENCE_KIND_NOT_ALLOWED` | 422 | sim, `REJECTED` | desiste |
| `REFERENCE_MISMATCH` | 422 | sim, `REJECTED` | desiste |
| `REFERENCE_AMOUNT_MISMATCH` | 422 | sim, `REJECTED` | desiste |
| `REFERENCE_NOT_PROCESSED` | 422 | sim, `REJECTED` | desiste |
| `REFERENCE_ALREADY_REVERSED` | 422 | sim, `REJECTED` | desiste |
| `TRANSIENT_FAILURE` | 503 | não | reenvia com a **mesma** key |
| `INTERNAL_ERROR` | 500 | não | reenvia com a mesma key. Se persistir, é bug nosso |

`PENDING_REFERENCE` não é erro: responde **202** e grava a transação.

## Erros de programação × rejeições de negócio

- **Rejeição de negócio** (saldo insuficiente, moeda errada): `Output.fail(IDomainError)`. É um caminho esperado e vira `REJECTED` com `failureCode`.
- **Erro de programação** (transição a partir de estado terminal, operar moedas diferentes dentro do `Money`): `throw` de uma classe que estende `Error`. Não deveria acontecer se o código estiver certo (OLD_README §6.3).
