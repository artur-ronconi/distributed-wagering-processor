<div align="center">

<img src="docs/imagens/capa.png" alt="Distributed Wagering Processor: o Wallet Console e o Flow Explorer mostrando uma aposta e duas requisições disputando a mesma carteira" width="100%">

# Distributed Wagering Processor

**Serviço financeiro que aplica apostas, vitórias, derrotas, reembolsos e estornos nas carteiras dos jogadores,<br>com saldo e extrato corretos mesmo quando as mensagens chegam duplicadas, fora de ordem ou ao mesmo tempo.**

![Bun 1.x](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript estrito](https://img.shields.io/badge/TypeScript-estrito-3178C6?logo=typescript&logoColor=white)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![MikroORM 6](https://img.shields.io/badge/MikroORM-6-2B6CB0)
![AWS SQS](https://img.shields.io/badge/AWS%20SQS-LocalStack-FF9900?logo=amazonsqs&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![248 testes](https://img.shields.io/badge/testes-248%20passando-10B981)

[Em 1 minuto](#em-1-minuto) ·
[O projeto em imagens](#o-projeto-em-imagens) ·
[Como funciona](#como-funciona) ·
[Decisões de engenharia](#decisões-de-engenharia) ·
[Como rodar](#como-rodar) ·
[Testes](#testes)

</div>

<br>

Desafio técnico da **Jungle Gaming**. Provedores de jogos enviam transações de aposta (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) por **HTTP** ou por **fila SQS**. O serviço aplica cada uma na carteira certa, mantém um **extrato imutável** e garante que nenhum dinheiro seja debitado duas vezes, criado do nada ou deixado negativo, mesmo com várias instâncias processando ao mesmo tempo. Como extensão, a carteira também aceita **depósito** e **saque** pelo caixa, com as mesmas garantias.

| 248 | 50× | 3 | 0 | 5s | 2 |
| :---: | :---: | :---: | :---: | :---: | :---: |
| testes automatizados passando | a mesma aposta em paralelo vira **um** débito | instâncias do serviço disputando a mesma carteira nos testes | mocks de PostgreSQL ou SQS | de espera máxima pelo lock de uma carteira, depois `503` | frontends para usar e para ver o sistema por dentro |

<details>
<summary><b>English summary</b></summary>

<br>

**Distributed Wagering Processor** is a financial service (NestJS on Bun, strict TypeScript, PostgreSQL with MikroORM, AWS SQS on LocalStack) that applies wager transactions sent by game providers over HTTP or an SQS FIFO queue. It keeps wallet balances and an append-only ledger correct under duplicated, out-of-order and concurrent messages, across multiple instances.

Highlights: money as exact integer cents (never floating point); a per-wallet row lock plus version-checked updates (no global lock); persistent idempotency keys with payload hashing (same key + different payload is a 409, not a replay); an inbox in the same SQL transaction as the money change and acks only after commit; a transactional outbox published with `FOR UPDATE SKIP LOCKED`; out-of-order references parked as `PENDING_REFERENCE` and retried with exponential backoff; database constraints and triggers that enforce the invariants on their own. 248 tests run against real PostgreSQL and LocalStack containers, including three real service processes competing for the same wallet and a `SIGKILL` between commit and ack.

Two companion frontends ship with it: the **Wallet Console**, to use the system as an operator, and the **Flow Explorer**, which animates the path each request takes through the code. The rest of this README is in Portuguese.

</details>

## Em 1 minuto

Requer Docker com Docker Compose e [Bun](https://bun.sh).

```bash
bun install
bun run start      # sobe PostgreSQL, LocalStack (filas criadas) e o backend, em segundo plano
bun run console    # Wallet Console → http://localhost:4001
bun run explorer   # Flow Explorer  → http://localhost:4000 (outro terminal)

bun run destroy    # para tudo e apaga containers, banco, filas e a imagem da app
```

| Parte | Para que serve | Onde |
|---|---|---|
| **Backend** | A API e os workers: aplica as transações, depósitos e saques, guarda saldo e extrato, consome a fila e publica eventos | http://localhost:3000 · [Swagger](http://localhost:3000/docs) |
| **Wallet Console** | **Usar** o sistema como um operador de cassino: criar carteiras, apostar, ganhar, perder, reembolsar, estornar e provocar cada regra de negócio | http://localhost:4001 |
| **Flow Explorer** | **Ver por dentro**: executa uma rota e anima, passo a passo, o caminho que ela fez no código, com o SQL, os locks e a fila | http://localhost:4000 |

## O projeto em imagens

### Wallet Console: o sistema do lado de quem usa

Cada navegador é um espaço próprio: dá para criar quantas carteiras quiser, mas nunca ver a carteira de outra pessoa. Na **mesa livre** você aposta e decide o resultado; no **cara ou coroa** a moeda decide. À direita, cada requisição feita ao backend aparece com o status e o que ele significa.

<img src="docs/imagens/console-jogar.png" alt="Wallet Console: carteira Mesa VIP com saldo, mesa livre, cara ou coroa e a lista de respostas do backend" width="100%">

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/imagens/console-transacoes.png" alt="Histórico de transações com vitórias, apostas e derrotas, e um reenvio reconhecido como o mesmo pedido">
</td>
<td width="50%" valign="top">
<img src="docs/imagens/console-extrato.png" alt="Extrato da carteira com saldo antes e depois, e a conferência saldo × extrato aprovada">
</td>
</tr>
<tr>
<td valign="top">

**Tudo o que foi enviado, inclusive o que não mexeu no saldo.** Rejeições e derrotas ficam registradas. **Reenviar** manda o mesmo pedido com a mesma `Idempotency-Key`: o backend devolve o resultado original (`200`) e não debita de novo.

</td>
<td valign="top">

**O extrato direto do backend** é só de inclusão: cada lançamento guarda o saldo antes e depois. **Conferir saldo × extrato** chama a reconciliação, que soma o extrato e compara com o saldo guardado, no mesmo instante do banco.

</td>
</tr>
</table>

#### Laboratório: cada regra, de propósito

Dez experimentos provocam as regras uma a uma: reenvio (`200`), mesma key com outro valor (`409`), mesmo id com outra key (`409`), saldo insuficiente (`422`), valor com 3 casas (`400`), reembolso duplo (`REFERENCE_ALREADY_REVERSED`), duas apostas simultâneas (uma passa, a outra não), estorno antes da aposta (`202`, resolvido sozinho pelo worker) e estorno de uma vitória já gasta (`REVERSAL_WOULD_OVERDRAW`).

<img src="docs/imagens/console-laboratorio.png" alt="Laboratório: o experimento de reembolsar duas vezes a mesma aposta, com o segundo recusado" width="100%">

#### Claro e escuro

<img src="docs/imagens/temas.png" alt="Wallet Console dividido na diagonal entre o tema claro e o escuro" width="100%">

### Flow Explorer: o mesmo pedido, visto por dentro

Escolha uma rota ou um cenário e execute. O diagrama anima o caminho pelas camadas (controller, use case, domínio, PostgreSQL, workers e SQS), com a faixa da **transação SQL**, o **🔒 lock** da carteira e a parte assíncrona que acontece depois da resposta. Cada passo mostra o **trecho real do código**, o SQL equivalente e a evidência.

O backend não foi instrumentado para isso: o caminho é reconstruído a partir de evidências reais (resposta HTTP, linhas no Postgres antes e depois, `published_at` da outbox, filas e logs do consumer). Cada passo diz se foi **observado** ou **inferido** do código.

<img src="docs/imagens/explorer-concorrencia.png" alt="Flow Explorer: duas apostas de 80.00 numa carteira de 100.00; a requisição B espera o lock da carteira enquanto A termina" width="100%">

<sub>Duas apostas de 80.00 ao mesmo tempo numa carteira com 100.00. A requisição **B** fica esperando o `SELECT … FOR UPDATE` enquanto **A** debita e faz COMMIT; quando B consegue o lock, já enxerga 20.00 e é rejeitada.</sub>

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/imagens/explorer-idempotencia.png" alt="Mesma Idempotency-Key com payload diferente: matchesPayload falha e a transação faz ROLLBACK">
</td>
<td width="50%" valign="top">
<img src="docs/imagens/explorer-fora-de-ordem.png" alt="ROLLBACK antes da BET: o worker de pendências reagenda a tentativa com backoff">
</td>
</tr>
<tr>
<td valign="top">

**Mesma key, outro conteúdo.** O hash do payload não bate: `409`, ROLLBACK e nada gravado. Com o mesmo conteúdo, o mesmo caminho devolveria o resultado original sem nem pegar o lock da carteira.

</td>
<td valign="top">

**Fora de ordem.** O estorno chegou antes da aposta: fica `PENDING_REFERENCE` e o worker tenta de novo com espera crescente. Quando a aposta chega, ele aplica o estorno sozinho.

</td>
</tr>
</table>

<img src="docs/imagens/explorer-inbox.png" alt="A mesma mensagem SQS entregue duas vezes: a inbox recusa a segunda e o consumer só dá ack" width="100%">

<sub>A mesma mensagem entregue duas vezes pela fila. Na segunda, o `INSERT … ON CONFLICT DO NOTHING` da inbox não insere nada: a mensagem já foi aplicada, e o consumer só dá ack.</sub>

## Como funciona

Um único serviço NestJS. A rota HTTP e o consumer da fila chamam **o mesmo use case**; tudo o que muda dinheiro acontece em **uma transação SQL**, e só a outbox publica eventos.

```mermaid
flowchart LR
  provedor(["Provedor de jogos"])
  http["POST /wagering/transactions"]
  fila[["wager-transactions.fifo"]]
  consumer["Consumer SQS<br/>inbox · ack após o commit"]
  dlq[["wager-transactions-dlq.fifo"]]
  uc["Submit use case<br/>idempotência · lock da carteira · regras"]
  db[("PostgreSQL<br/>wallets · ledger · transactions<br/>inbox · outbox")]
  pendencias["Worker de pendências<br/>backoff exponencial"]
  publisher["Outbox publisher<br/>FOR UPDATE SKIP LOCKED"]
  eventos[["wagering-events.fifo"]]

  provedor --> http --> uc
  provedor --> fila --> consumer --> uc
  consumer -. "erro permanente" .-> dlq
  uc -- "uma transação" --> db
  pendencias <--> db
  db --> publisher --> eventos
```

O que acontece numa aposta, em ordem:

1. **Validação pura**, sem abrir transação: `Money` com exatamente 2 casas, tipo da transação, hash do payload.
2. **Já vi esse pedido?** Busca pela `Idempotency-Key`. Mesmo conteúdo → devolve o resultado original; conteúdo diferente → `409`.
3. **`SELECT … FOR UPDATE`** só na linha da carteira. Carteiras diferentes seguem em paralelo.
4. **Regras de negócio** no domínio: dono da carteira, moeda, referência, saldo suficiente. O desfecho é `PROCESSED`, `REJECTED` ou `PENDING_REFERENCE`, e os três são gravados.
5. **Na mesma transação:** a transação, o novo saldo (`UPDATE … WHERE version = esperada`), o lançamento do extrato, os eventos na outbox e, se veio da fila, a inbox. **COMMIT.**
6. **Depois do commit:** a resposta (ou o ack da mensagem). O publisher envia os eventos para a fila de saída.

## Decisões de engenharia

Os pontos mais importantes, com o caminho para ler o código. A justificativa completa está no [`ARCHITECTURE.md`](ARCHITECTURE.md).

**1. Dinheiro nunca é `number`.** [`MoneyValueObject`](src/modules/wallet/domain/aggregate/value-objects/money/money.value-object.ts) guarda centavos em `bigint`, aceita só strings com exatamente 2 casas e recusa operações entre moedas diferentes. No banco, `numeric(19,2)`.

**2. Concorrência por carteira, sem lock global.** `SELECT … FOR UPDATE` na linha da carteira ([`mikro-orm.wallet.repository.ts`](src/modules/wallet/infrastructure/database/repositories/mikro-orm.wallet.repository.ts)) mais um `UPDATE` condicionado pela `version`. Um `lock_timeout` de 5s transforma espera longa em `503` com `Retry-After`. Uma corrida em constraint `UNIQUE` é refeita até 3 vezes e responde como replay.

**3. Idempotência persistente.** `UNIQUE (idempotency_key)` + SHA-256 do JSON canônico dos campos de negócio. O mesmo `externalTransactionId` não pode chegar com duas keys. Ver [`submit-wager-transaction.usecase.ts`](src/modules/wager-transaction/domain/usecases/submit-wager-transaction/submit-wager-transaction.usecase.ts).

**4. Uma regra de negócio, três entradas.** [`processor.decide()`](src/modules/wager-transaction/domain/usecases/process-wager-transaction/wager-transaction.processor.ts) é usado pela rota HTTP, pelo consumer SQS e pelo worker de pendências. Ele decide e aplica em memória; quem grava é o use case.

**5. Inbox e outbox na transação do dinheiro.** A [inbox](src/modules/messaging/infrastructure/database/repositories/mikro-orm.inbox-message.repository.ts) deduplica entregas com `ON CONFLICT DO NOTHING`; o ack só sai depois do commit. A [outbox](src/modules/messaging/domain/usecases/publish-outbox/publish-outbox.usecase.ts) é publicada por várias instâncias com `FOR UPDATE SKIP LOCKED`, com entrega at-least-once. Erros permanentes vão para a DLQ; transitórios voltam com backoff.

**6. Fora de ordem não é erro.** Um estorno que chega antes da aposta fica `PENDING_REFERENCE` e o [worker de pendências](src/modules/wager-transaction/domain/usecases/resolve-pending-references/resolve-pending-references.usecase.ts) tenta de novo com backoff (1s, 2s, 4s… até 60s, 10 tentativas). Esgotado, vira `REJECTED` com `REFERENCE_NOT_FOUND`.

**7. O banco garante as invariantes sozinho.** Na [migration](src/shared/infrastructure/database/migrations/Migration20261014120000InitialSchema.ts): saldo `>= 0`, lançamento que fecha a conta (`antes ± valor = depois`), uma carteira por jogador e moeda, uma reversão por aposta (índice único parcial) e um **trigger** que recusa `UPDATE` e `DELETE` no extrato.

**8. Depósito e saque sem um segundo caminho para o dinheiro.** `POST /wallets/:walletId/deposits` e `/withdrawals` (extensão, fora do enunciado) gravam transações internas `DEPOSIT` e `WITHDRAWAL`, decididas pelo mesmo `processor.decide()`. Herdam a idempotência (key com escopo na carteira), o lock, o extrato, a outbox e a reconciliação; um saque maior que o saldo é `422 INSUFFICIENT_FUNDS`, gravado e auditável. Provedores não conseguem criar essas operações, nem pela API nem direto no banco. Ver [`move-wallet-funds.usecase.ts`](src/modules/wallet/domain/usecases/move-wallet-funds/move-wallet-funds.usecase.ts) e a [seção 14 do ARCHITECTURE.md](ARCHITECTURE.md#14-depósito-e-saque-extensão).

**9. DDD com fronteiras explícitas.** Três módulos (`wallet`, `wager-transaction`, `messaging`), aggregates com factories (`create`, `rehydrate`), entidades imutáveis e o domínio sem nenhum import do NestJS ou do ORM.

<details>
<summary><b>Status HTTP de <code>POST /wagering/transactions</code></b></summary>

<br>

| Status | Quando |
|---|---|
| `201` | Transação nova, processada |
| `200` | Reenvio idêntico (`idempotentReplay: true`), com o resultado original |
| `202` | `PENDING_REFERENCE`: a transação referenciada ainda não chegou |
| `400` | Formato inválido (ex.: valor sem 2 casas, `Idempotency-Key` ausente) |
| `404` | Carteira inexistente |
| `409` | Mesma key com outro conteúdo, ou o mesmo id externo com outra key |
| `422` | Rejeitada por regra de negócio (saldo insuficiente, referência inválida…), com o resultado no corpo |
| `503` | Carteira ocupada por mais de 5s ou dependência fora: seguro tentar de novo (`Retry-After`) |

Todas as rotas, schemas e exemplos estão no Swagger em http://localhost:3000/docs.

</details>

## Como rodar

### Tudo com Docker (recomendado)

```bash
bun install
bun run start
```

`bun run start` é `docker compose up -d --build --wait`: sobe PostgreSQL, LocalStack (já com as filas criadas) e o backend, que aplica as migrations no boot. O terminal só volta quando os três estão saudáveis. Nenhum passo manual.

| O quê | Onde |
|---|---|
| API | http://localhost:3000 |
| Swagger (OpenAPI) | http://localhost:3000/docs · JSON em `/docs/json` |
| Métricas (Prometheus) | http://localhost:3000/metrics |
| Health | http://localhost:3000/health/live · http://localhost:3000/health/ready |
| PostgreSQL | `localhost:5433` (usuário, senha e banco `wagering`) |
| LocalStack (SQS) | `localhost:4566` |

`bun run destroy` para tudo e apaga containers, o volume do banco, as filas e a imagem da app; o próximo `start` recomeça do zero. Para só parar sem apagar: `docker compose down`.

### Frontends

Com o backend no ar, cada um em um terminal:

```bash
bun run console    # Wallet Console → http://localhost:4001
bun run explorer   # Flow Explorer  → http://localhost:4000
```

Mais detalhes em [`frontends/`](frontends/README.md): o que cada aba faz, como o Flow Explorer reconstrói o caminho e o que cada um lê.

### Pela linha de comando

```bash
# criar uma carteira com 100.00 (gera a transação OPENING e o primeiro lançamento)
curl -s -X POST localhost:3000/wallets -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'

# apostar 25.00 (repita o comando: a resposta vira 200 com idempotentReplay: true)
curl -s -X POST localhost:3000/wagering/transactions -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  -d '{"providerId":"provider-a","externalTransactionId":"transaction-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
       "walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'

# depósito e saque pelo caixa (Idempotency-Key obrigatória, com escopo na carteira)
curl -s -X POST localhost:3000/wallets/<walletId>/deposits -H 'content-type: application/json' \
  -H 'Idempotency-Key: cashier:deposit-1' -d '{"money":{"amount":"50.00","currency":"BRL"}}'
curl -s -X POST localhost:3000/wallets/<walletId>/withdrawals -H 'content-type: application/json' \
  -H 'Idempotency-Key: cashier:withdrawal-1' -d '{"money":{"amount":"30.00","currency":"BRL"}}'

# extrato e reconciliação
curl -s localhost:3000/wallets/<walletId>/ledger
curl -s -X POST localhost:3000/wallets/<walletId>/reconciliation

# a mesma operação pela fila
docker compose exec localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id <walletId> --message-deduplication-id msg-1 \
  --message-body '{"messageId":"msg-1","type":"WagerTransactionRequested","occurredAt":"2026-07-29T15:00:00.000Z",
    "data":{"providerId":"provider-a","externalTransactionId":"transaction-124","idempotencyKey":"provider-a:transaction-124",
    "playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp",
    "kind":"WIN","money":{"amount":"50.00","currency":"BRL"}}}'
```

### Desenvolvimento sem o container da app

```bash
cp .env.example .env
docker compose up -d postgres localstack --wait
bun run migration:up        # bun run migration:down reverte a última
bun run dev                 # watch mode
```

<details>
<summary><b>Variáveis de ambiente principais</b></summary>

<br>

Todas em [`.env.example`](.env.example) e [`src/config/app-config.ts`](src/config/app-config.ts).

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL` | `postgres://wagering:wagering@localhost:5433/wagering` | conexão |
| `AWS_ENDPOINT_URL` | — | `http://localhost:4566` para LocalStack |
| `LOCK_TIMEOUT_MS` | `5000` | espera máxima pelo lock de uma carteira antes de responder `503` |
| `RUN_HTTP`, `RUN_SQS_CONSUMER`, `RUN_OUTBOX_PUBLISHER`, `RUN_PENDING_REFERENCE_WORKER` | `true` | liga e desliga cada entrada (permite instâncias só de worker) |
| `PENDING_REFERENCE_MAX_ATTEMPTS` | `10` | tentativas antes de `REFERENCE_NOT_FOUND` (~5 min com o backoff padrão) |
| `MIGRATIONS_RUN_ON_BOOT` | `true` | aplica migrations ao subir (serializado por advisory lock entre instâncias) |
| `LOG_LEVEL` | `info` | logs JSON (pino) |

</details>

## Testes

Integração e concorrência rodam contra **PostgreSQL e LocalStack reais** (os containers do Compose), com banco (`wagering_test`) e filas (`*-test.fifo`) separados dos da aplicação. Nada é mockado.

Cada comando de teste é **independente**: antes de rodar, ele confere se o que precisa está de pé (PostgreSQL e LocalStack; o de carga também a app), sobe só o que faltar e deixa como está o que já estiver rodando. Nada é parado no fim. Só precisa do Docker aberto.

```bash
bun test                    # 108 unitários: domínio e eventos (não usa containers)
bun run test:integration    # 133 de integração: API, depósito e saque, persistência, mensageria, Swagger e health
bun run test:concurrency    # 7 de concorrência: paralelismo real, 3 processos, SIGKILL + restart
bun run test:all            # os três
bun run test:load           # carga (opcional), sobe a stack inteira se precisar: ver ARCHITECTURE §16
bun run typecheck
```

| Exigência do desafio | Onde |
|---|---|
| `Money`: escala, entradas inválidas, conflito de moeda | [`test/unit/domain/money.value-object.spec.ts`](test/unit/domain/money.value-object.spec.ts) |
| Invariantes da `Wallet`, regras de BET/WIN/LOSS/REFUND/ROLLBACK | `test/unit/domain/*.spec.ts`, [`test/integration/api/wager-transactions.spec.ts`](test/integration/api/wager-transactions.spec.ts) |
| Idempotency key com payload divergente | `wager-transactions.spec.ts` (409) e unitário de `matchesPayload` |
| Migrations e constraints | [`test/integration/database/persistence.spec.ts`](test/integration/database/persistence.spec.ts) |
| Atomicidade wallet, ledger, inbox e outbox | `persistence.spec.ts` (rollback de tudo junto) |
| Inbox e redelivery, retry e DLQ | [`test/integration/messaging/messaging.spec.ts`](test/integration/messaging/messaging.spec.ts) |
| Publishers concorrentes na mesma outbox | `messaging.spec.ts` e 3 instâncias em `test/concurrency` |
| Mesma aposta 50× em paralelo → um débito | [`test/concurrency/concurrency.spec.ts`](test/concurrency/concurrency.spec.ts) (1) |
| 100.00 com duas apostas de 80.00 simultâneas | `concurrency.spec.ts` (2) |
| Wallets distintas em paralelo | `concurrency.spec.ts` (3) |
| ≥ 3 processos simultâneos | `concurrency.spec.ts` (4): três `bun src/main.ts` reais |
| Worker morto depois do commit e antes do ack | `messaging.spec.ts` e `concurrency.spec.ts` (5/8, `SIGKILL`) |
| `ROLLBACK`/`REFUND` antes da referência | `wager-transactions.spec.ts` e `concurrency.spec.ts` (7) |
| Reinício com consistência final | `concurrency.spec.ts` (5/8) |
| Carga (diferencial): throughput, p50/p95/p99, erros, conflitos, lag da outbox | [`test/load/load.ts`](test/load/load.ts), resultados em ARCHITECTURE §16 |
| Invariante final `wallet.balance == ledger` | `expectLedgerMatchesBalances` em todos os testes que movem dinheiro |
| Swagger completo (todas as rotas e status, com exemplos) | [`test/integration/docs/swagger.spec.ts`](test/integration/docs/swagger.spec.ts) |
| Depósito e saque (extensão): replay, conflito, saldo insuficiente, saques paralelos | [`test/integration/api/wallet-operations.spec.ts`](test/integration/api/wallet-operations.spec.ts) |

## Estrutura

```
src/
  config/              configuração e composição (MikroORM, lista de schemas)
  shared/              kernel compartilhado: failure codes, erros, unit of work, SQS client, métricas, health, HTTP, Swagger
  modules/
    wallet/              carteira, dinheiro (Money) e lançamentos do extrato
    wager-transaction/   BET/WIN/LOSS/REFUND/ROLLBACK: rota HTTP, consumer SQS, worker de pendências
    messaging/           inbox, outbox, eventos de integração e publicação no SQS
      └─ cada módulo: domain/ (aggregate, events, mappers, interfaces, usecases)
                      presentation/ (controllers, consumers, producers)
                      infrastructure/ (database, services)
test/
  unit/  integration/  concurrency/
frontends/
  wallet-console/      usar o sistema (só pela API pública)
  flow-explorer/       ver o caminho de cada requisição no código
docs/                  requisitos, um arquivo por classe de domínio e por rota, imagens deste README
```

## Documentação

- [`ARCHITECTURE.md`](ARCHITECTURE.md): decisões, trade-offs e limitações (dinheiro, ORM e transações, concorrência, idempotência, outbox, consumer, autenticação, testes).
- [`OLD_README.md`](OLD_README.md): o enunciado do desafio.
- [`docs/requirements.md`](docs/requirements.md): os requisitos condensados; [`docs/domain/`](docs/domain) e [`docs/routes/`](docs/routes) detalham cada classe e cada rota.
- [`frontends/`](frontends/README.md): os dois frontends.

**Autenticação** ficou fora de escopo de propósito (não pontua no desafio): existe um `AuthGuard` no-op como ponto de extensão para um IdP externo, e a decisão está documentada no [`ARCHITECTURE.md`](ARCHITECTURE.md#12-autenticação).
