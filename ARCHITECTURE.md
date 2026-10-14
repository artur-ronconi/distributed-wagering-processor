# Arquitetura

Decisões, trade-offs e limitações do **Distributed Wagering Processor**. O enunciado está em [`OLD_README.md`](OLD_README.md); a especificação detalhada, em [`docs/`](docs/requirements.md).

## 1. Visão geral

```
                    ┌──────── HTTP ─────────┐
 Provedor ──────────┤ POST /wagering/...    ├──┐
                    └───────────────────────┘  │      uma transação SQL
                                               ▼   ┌──────────────────────────────┐
                              SubmitWagerTransactionService                       │
                                      │  WagerTransactionProcessor (regras)       │
                                      ▼                                           │
 Provedor ──► SQS wager-transactions.fifo ──► Consumer ──► inbox ─┐               │
                         │                                        ├─► wager_transactions
                         └─(permanente)─► ...-dlq.fifo            ├─► wallets (lock da linha)
                                                                  ├─► wallet_ledger_entries
                                                                  └─► outbox_messages
                                                                           │ COMMIT
                                     Outbox publisher (N instâncias) ◄─────┘
                                           │ FOR UPDATE SKIP LOCKED
                                           ▼
                                  SQS wagering-events.fifo ──► outros sistemas
                       Pending-reference worker ──► reprocessa PENDING_REFERENCE
```

Um único serviço NestJS. Cada processo pode ligar ou desligar quatro entradas: HTTP, consumer SQS, publisher da outbox e worker de pendências. HTTP e consumer chamam **o mesmo use case**, e o worker de pendências usa o mesmo `WagerTransactionProcessor`. Assim, cada regra de negócio existe em um lugar só.

## 2. Camadas e modelagem (DDD)

O código é organizado **por módulo** (`wallet`, `wager-transaction`, `messaging`) e, dentro de cada módulo, por camada:

- `domain/` — aggregates (`aggregate-root`, `entities`, `value-objects`), eventos, mappers de visão, `services` (só interfaces) e `usecases`;
- `presentation/` — `controllers` (HTTP), `consumers` (SQS e worker de pendências) e `producers` (publisher da outbox);
- `infrastructure/` — `database` (schemas, mappers linha ⇄ aggregate, repositories, queries) e `services` (implementações, como o publisher SQS).

O que é comum fica em `src/shared` (failure codes, erros, unit of work, SQS client, métricas, health, HTTP comum). As classes de aggregate são TypeScript puro sobre o `ddd-tool-kit`, sem NestJS e sem ORM. As dependências apontam para o domínio: a infraestrutura implementa as interfaces de `domain/services`. Cada módulo é um módulo Nest. `wallet` e `wager-transaction` dependem um do outro (criar uma wallet gera a transação interna OPENING; uma aposta mexe na wallet), resolvido com `forwardRef`.

| Aggregate | Contém | Repository |
|---|---|---|
| `WalletAggregate` | `WalletLedgerEntryEntity` (filhas; só os lançamentos **novos** ficam em memória) | `WalletRepository` (atualiza a carteira + insere os lançamentos novos) |
| `WagerTransactionAggregate` | só o root | `WagerTransactionRepository` |
| `InboxMessageAggregate` / `OutboxMessageAggregate` | só o root (mecanismo técnico, em `domain/messaging`) | um repository cada |

- **Saldo e ledger nascem juntos.** `wallet.debit()`/`credit()` muda o saldo e cria o lançamento no mesmo método, porque a invariante "toda alteração de saldo tem um lançamento" envolve os dois. O histórico nunca é carregado no aggregate: o extrato e a reconciliação são consultas de leitura (read side).
- **Factories:** `create`/`open`/`from` validam e retornam `Output`. `rehydrate` reconstrói o que veio do banco **sem revalidar** transições.
- **Erros:** rejeição de negócio é `Output.fail(IDomainError)`, com um `failureCode` estável. Transição inválida, como sair de um estado terminal, é erro de programação e lança exceção (`InvalidTransactionStateError`).
- **Imutabilidade do ledger:** `Object.freeze` nas props (o toolkit expõe props mutáveis), sem setters, mais um trigger no banco que bloqueia `UPDATE` e `DELETE`.
- **Trade-off:** o DDD recomenda modificar um aggregate por transação. Aqui uma transação SQL salva `Wallet` + `WagerTransaction` + inbox + outbox. É intencional: o enunciado (§6.5 e §11) exige essa atomicidade.
- **Ids:** o `IdValueObject` do `ddd-tool-kit` só aceita ids de 16 caracteres, então os nossos ids são `char(16)` e não UUID. Ids externos (`playerId`, `providerId`, `externalTransactionId`) são `text`.

## 3. Dinheiro

- `MoneyValueObject` guarda **centavos em `bigint`**. Como a escala é sempre 2 e o domínio só soma e subtrai, não existe arredondamento.
- Contrato: string com **exatamente** 2 casas (`"25.00"`). `"25"`, `"25.0"`, `"25.005"`, `"1e3"`, `"025.00"` e negativos são rejeitados na entrada. Decisão: a "escala fixa de 2 casas" do enunciado vale também para a entrada; nada é arredondado silenciosamente.
- O valor pode ser negativo em memória (por exemplo, a diferença da reconciliação). "Saldo nunca negativo" é regra da `Wallet`, garantida também por `CHECK` no banco.
- Banco: `numeric(19,2)` + `char(3)`. O driver devolve `numeric` como string, que volta para o domínio por `MoneyValueObject.from`. Nunca passa por `number`.
- Operar moedas diferentes lança erro dentro do `Money`. A `Wallet` confere a moeda antes e devolve `CURRENCY_MISMATCH` como rejeição de negócio.

## 4. ORM e transações

**MikroORM 6** (preferido pelo enunciado).

- **`EntitySchema` na infraestrutura**, não decorators nas classes de domínio. Mappers bidirecionais convertem linha ⇄ aggregate.
- **Escritas explícitas:** `em.insert`, `em.insertMany` e `em.nativeUpdate`, com leituras `disableIdentityMap`. Não uso o change tracking do Unit of Work do MikroORM para dados financeiros: cada transação faz exatamente os comandos SQL que estão no código, o que facilita provar o comportamento sob concorrência.
- **`UnitOfWork` (porta) → `em.transactional()`**. O `EntityManager` injetado nos repositories resolve para o fork da transação corrente (`TransactionContext`). Quem abre a transação é o use case, nunca o repository. Toda transação começa com `SET LOCAL lock_timeout`.
- **Tradução de erros:** violação de `UNIQUE` vira `DuplicateKeyError(constraint)`. Lock timeout, deadlock, serialization failure e falha de conexão viram `TransientInfrastructureError`, que a API responde como `503` e o consumer trata como "não dá ack".
- **Migrations** escritas à mão (o schema canônico, com todas as constraints), reversíveis (`up`/`down`) e aplicadas no boot dentro de um `pg_advisory_xact_lock`. Três instâncias subindo juntas não migram em paralelo (isso é testado).

## 5. Concorrência

**Unidade de concorrência = `walletId`.** Estratégia: **lock pessimista da linha** (`SELECT … FOR UPDATE`) + **update condicionado por `version`** como rede de segurança.

- Operações na mesma carteira fazem fila no lock. Carteiras diferentes rodam em paralelo. Não existe lock global.
- **Por que pessimista e não só otimista?** Numa carteira "quente" (muitas apostas simultâneas), o otimista vira uma tempestade de retries e falhas `409`/`503`. Com o lock, a fila é ordenada e o banco decide quem vem primeiro. O `WHERE version = expected` continua no `UPDATE`: se algo contornar o lock, o update afeta 0 linhas e a operação é refeita, em vez de sobrescrever o saldo.
- **`lock_timeout` de 5s:** uma carteira travada por tempo demais responde `503 TRANSIENT_FAILURE` + `Retry-After`, em vez de segurar conexões indefinidamente. O provedor reenvia com a mesma chave.
- **Ordem de locks:** a rota de envio trava só a carteira. O worker de pendências trava a transação pendente (`SKIP LOCKED`) e depois a carteira. Nenhum caminho trava na ordem inversa.
- **Cenário obrigatório** (100.00, duas apostas de 80.00): uma `PROCESSED`, uma `REJECTED INSUFFICIENT_FUNDS`, saldo 20.00, um único `DEBIT`. Testado 10 vezes seguidas, em paralelo real e com 3 processos.

## 6. Idempotência

- **Chave:** o header `Idempotency-Key` (no SQS, `data.idempotencyKey`) é a fonte da verdade, garantida por `UNIQUE (idempotency_key)` no banco.
- **`payloadHash`:** SHA-256 (hex) do **JSON canônico** (chaves ordenadas em todos os níveis, sem espaços, campos ausentes omitidos) apenas dos campos de negócio: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money.amount`, `money.currency` e `referenceExternalTransactionId`. Header, `messageId`, `occurredAt` e metadados de transporte ficam de fora, então HTTP e SQS geram o mesmo hash para a mesma operação.
- **Mesma chave e mesmo hash → replay.** Devolve o resultado original, inclusive o **saldo observado naquele momento** (`observed_balance_amount`, gravado na transação quando ela é decidida). Status `200` para `PROCESSED` e `422` para `REJECTED`.
- **Mesma chave e hash diferente → `409 IDEMPOTENCY_CONFLICT`**, sem gravar nada. O mesmo `(providerId, externalTransactionId)` sob outra chave também é `409`.
- **Corrida:** a idempotência é verificada antes do lock (caminho rápido) e de novo depois dele. Se dois pedidos idênticos chegarem juntos, o `UNIQUE` deixa um vencer. O outro faz rollback e é refeito (até 3 tentativas), e na segunda tentativa responde como replay. Testado com 50 pedidos iguais em paralelo e com 30 pedidos iguais espalhados em 3 processos.
- **Nuance:** a validação de formato roda antes de abrir a transação. Um payload **inválido** com uma chave já usada recebe `400`, não `409`. Os dois são não-retentáveis.

### Inbox × chave de idempotência

As duas proteções se sobrepõem num caso: o SQS reentregar a mesma mensagem.
- A **chave** é a garantia financeira, porque vale para HTTP e SQS e pega a mesma operação vinda por caminhos diferentes.
- A **inbox** `(consumer_name, message_id)` é a deduplicação do consumer: é genérica (não depende de chave de negócio) e é exigida pelo enunciado (§10).

Mantive as duas. A inbox é gravada na mesma transação, então "processei" e "apliquei" são sempre verdade juntos. Ela também separa a métrica de **redelivery do SQS** (`wagering_duplicates_total{source="inbox"}`, problema nosso) da de **retry do provedor** (`{source="idempotency_key"}`).

## 7. Regras de reversão e referências fora de ordem

- **Uma reversão por referência, no total.** O enunciado (§7.4) diz "não pode ser revertida duas vezes **pelo mesmo tipo**". Ao pé da letra, isso permitiria um `REFUND` e depois um `ROLLBACK` da mesma `BET`, creditando o valor duas vezes. Adotei a leitura segura: `REFUND` e `ROLLBACK` dividem uma única vaga por referência (checado sob o lock da carteira e por índice único parcial em `reference_transaction_id`).
- `REFUND` só referencia `BET`. `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`. `WIN` pode referenciar a sua `BET`. Exige mesmo provedor, jogador, carteira, moeda e rodada, e mesmo valor (sem reversão parcial).
- `ROLLBACK` que deixaria o saldo negativo: `REVERSAL_WOULD_OVERDRAW`, diferente de `INSUFFICIENT_FUNDS`.
- **Referência ausente:** a transação é gravada como `PENDING_REFERENCE` (`202`). O worker tenta de novo com backoff exponencial: 1s, depois 2, 4, 8, 16, 32 e 60s (teto), por **10 tentativas, cerca de 5 minutos**. Esse tempo cobre atrasos normais de rede e de fila entre mensagens de uma mesma rodada sem segurar pendências por horas. Esgotado o limite, vira `REJECTED REFERENCE_NOT_FOUND` e publica `WagerTransactionRejected`. Tudo é configurável por variáveis de ambiente.

## 8. Outbox

- Os eventos são gravados na **mesma transação** do dinheiro. Nada é publicado antes do commit.
- O publisher, que roda em N instâncias, pega lotes com `FOR UPDATE SKIP LOCKED`: duas instâncias nunca publicam a mesma linha ao mesmo tempo (testado com publishers concorrentes e com 3 processos).
- **At-least-once:** se o processo morre depois de publicar e antes de marcar `published_at`, outra instância publica de novo. A fila de eventos é FIFO, com `MessageGroupId = aggregateId` (ordem por carteira/transação) e `MessageDeduplicationId = eventId` (descarta reenvios em 5 minutos). Mesmo assim, consumidores devem deduplicar por `eventId`.
- Uma falha ao publicar faz `scheduleRetry`: backoff de 1s a 5 min. Sem DLQ: a linha continua tentando, e `wagering_outbox_lag_seconds` mostra o atraso.
- **Trade-off conhecido:** o lock das linhas é mantido durante a chamada ao SQS. Com lote de 50 e SQS saudável isso dura milissegundos. A alternativa seria um lease (`locked_until`), que solta o lock antes da chamada de rede, mas adiciona estado e outro tipo de corrida. Fica como evolução se o lag virar problema.

## 9. Consumer SQS

| Resultado do use case | Ação |
|---|---|
| `PROCESSED`, `REJECTED`, `PENDING_REFERENCE`, replay, ou inbox já tinha o `messageId` | **ack** (resultado definitivo está no banco) |
| `INVALID_PAYLOAD`, `INVALID_AMOUNT`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND`, mensagem malformada (nada foi gravado) | **DLQ explícita**, com o motivo em `MessageAttributes.failureCode` |
| `TRANSIENT_FAILURE` ou erro inesperado | **sem ack**: `ChangeMessageVisibility` com backoff de 2^n s (até 5 min). Depois de `maxReceiveCount = 5`, a redrive policy manda para a DLQ |

- **Ack só depois do commit.** "Worker morto depois do commit e antes do ack" é seguro: a reentrega encontra a inbox e só dá ack (testado também com `SIGKILL` de um processo real no meio de uma rajada).
- As mensagens de um lote são processadas em sequência, para preservar a ordem FIFO dentro do grupo. O provedor deve usar `MessageGroupId = walletId`, mas isso é otimização: a correção vem do banco.
- **Desligamento (SIGTERM):** o `/health/ready` passa a responder `503`. O consumer termina a mensagem em andamento e devolve a visibilidade (`0`) das recebidas e não iniciadas. O long poll em curso **não é abortado**: os testes mostraram que, ao abortar do lado do cliente, o servidor ainda entrega a próxima mensagem para a requisição abandonada e a esconde pelo visibility timeout inteiro. Esperar o long poll terminar custa no máximo `WaitTimeSeconds` (5s).

## 10. Contrato HTTP

| Situação | Status |
|---|---|
| Processada agora / criada | `201` |
| Consulta, replay de `PROCESSED`, reconciliação | `200` |
| Aguardando referência | `202` |
| Payload inválido | `400` |
| Não encontrado | `404` |
| Conflito (idempotência, carteira duplicada) | `409` |
| Rejeição de negócio (`REJECTED` + `failureCode`) | `422` |
| Falha transitória | `503` + `Retry-After` |
| Erro inesperado | `500` |

- Erros têm sempre `{ code, message, correlationId }`.
- `POST /wagering/transactions` com `REJECTED` devolve o resultado da transação (com `failureCode`), porque a rejeição foi gravada e tem um `transactionId`.
- A taxonomia completa (o que o provedor deve fazer em cada código) está em [`docs/domain/shared.md`](docs/domain/shared.md) e no Swagger.

## 11. Observabilidade

- **Logs JSON (pino)** com `correlationId` em todas as linhas da requisição, mais `walletId`, `transactionId`, `providerId` e `messageId` onde existirem. Corpos de requisição e payloads financeiros nunca são logados, e `Authorization` é redigido. `X-Correlation-Id` é aceito, gerado quando ausente e devolvido na resposta. Nos eventos, ele vira `correlationId`, e o `messageId` do SQS vira `causationId`.
- **Métricas** em `GET /metrics`:

| Métrica | O que mede |
|---|---|
| `wagering_transactions_total{status,kind}` | transações por status e tipo |
| `wagering_duplicates_total{source}` | duplicatas detectadas, por origem |
| `wagering_retries_total{source}` | retries |
| `wagering_dlq_messages_total{reason}` | mensagens enviadas à DLQ |
| `wagering_lock_conflicts_total` | conflitos de lock que esgotaram as tentativas |
| `wagering_outbox_lag_seconds`, `wagering_outbox_pending` | atraso da outbox, lido do banco a cada scrape, então correto com N instâncias |
| `wagering_processing_seconds{source}` | latência de processamento |
| `wagering_reconciliation_mismatches_total` | reconciliações divergentes |
| `http_request_duration_seconds{method,route,status}` | latência HTTP |

- **Health:**
  - `/health/live` não faz I/O. Uma queda do banco não pode fazer o orquestrador reiniciar tudo.
  - `/health/ready` checa PostgreSQL (`select 1`) e SQS (a fila de entrada existe), com timeout de 1s cada.
  - Nenhum dos dois exige autenticação.

## 12. Autenticação

**Decisão: não implementada** (não pontua; o tempo foi para correção financeira e concorrência). O ponto de extensão é o `AuthGuard` global (`src/shared/presentation/http/auth.guard.ts`). Hoje ele é no-op, e as rotas `@Public()` (health, métricas, docs) já ficam de fora.

Desenho para implementar:
1. Subir um IdP externo (Keycloak ou Zitadel) no Compose, com um client por provedor (client credentials).
2. No guard, validar o `Authorization: Bearer` pela JWKS do IdP (assinatura, `iss`, `aud`, `exp`).
3. Comparar a identidade do provedor no token com o `providerId` do corpo. Para mensagens da fila (canal interno confiável), aplicar a mesma validação de domínio sobre o `providerId` da mensagem.

Nenhuma tabela própria de usuários ou senhas.

## 13. Estratégia de testes

- **Unitários:** domínio puro (`Money`, `Wallet`, ledger, máquina de estados, reversões, inbox/outbox, eventos).
- **Integração:** a aplicação Nest real, no mesmo processo, contra **PostgreSQL e LocalStack reais**, com um banco (`wagering_test`) e filas (`*-test.fifo`) próprios. Cobre API, constraints, migrations up/down, atomicidade, inbox/redelivery, DLQ, retry, publishers concorrentes, Swagger e health.
- **Concorrência:** paralelismo real (`Promise.all` de requisições HTTP), **3 processos `bun src/main.ts` separados** disputando a mesma carteira, e `SIGKILL` de um processo no meio de uma rajada de 300 mensagens, seguido de restart.
- Todo teste que move dinheiro termina conferindo `wallet.balance == saldo reconstruído pelo ledger`.

Detalhes de SQS FIFO que os testes revelaram e que estão documentados no código de teste:
- A deduplicação dura 5 minutos, então os ids de deduplicação precisam ser únicos por execução.
- Uma mensagem recebida e não apagada segura as entregas seguintes do grupo.
- Abortar um long poll do lado do cliente pode "prender" a próxima mensagem (seção 9).
- Os testes drenam as filas (receive + delete) em vez de usar `PurgeQueue`, que, segundo a documentação da AWS, pode apagar também mensagens enviadas durante a limpeza.

## 14. Limitações e próximos passos

- **Teste de carga** (`bun run test:load`, diferencial) ainda não implementado.
- **Lock da outbox durante a publicação** (seção 8). Lease seria o próximo passo se o lag crescer.
- **`created_at` vem do relógio da instância.** A ordem do extrato é estável (keyset por `created_at, id`), mas, com relógios dessincronizados entre instâncias, "mais recente primeiro" pode ficar levemente fora de ordem. Usar `clock_timestamp()` do banco resolveria.
- **LocalStack fixado em 4.4.0:** as imagens mais novas exigem token de conta. O comportamento do SQS real foi seguido (FIFO, redrive, visibilidade), mas não foi validado em uma conta AWS.
- **Consumidores dos eventos** (notificação, BI) estão fora do escopo. Só a publicação é implementada.
- **Ids de 16 caracteres** por causa do `ddd-tool-kit` (os exemplos do enunciado usam UUIDv7). Trocar exigiria um `IdValueObject` próprio.
- **Escalabilidade de uma carteira muito quente:** o throughput por carteira é limitado pelo lock (serial por definição). Carteiras diferentes escalam horizontalmente com o número de instâncias e de conexões.
