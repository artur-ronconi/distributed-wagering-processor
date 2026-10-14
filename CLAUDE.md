# CLAUDE.md — Raiz do projeto

Desafio técnico da **Jungle Gaming**: **Distributed Wagering Processor**. Um serviço financeiro (NestJS) que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) enviadas por provedores de jogos, por HTTP ou por fila SQS, mantendo saldo e ledger corretos com mensagens duplicadas, fora de ordem e concorrentes.

**O `OLD_README.md` é a fonte da verdade** (é o enunciado do desafio). Se este arquivo ou qualquer arquivo em `docs/` contradisser o OLD_README, vale o OLD_README.

O `README.md` é um **entregável** do projeto (setup e comandos, OLD_README §14), ainda a ser escrito. Não confunda os dois.

Resumo de tudo que precisa ser feito: `docs/requirements.md`.

## O que está sendo avaliado

Correção financeira (20), concorrência (20), idempotência (15), mensageria e falhas (15), modelagem e arquitetura (10), testes (10), observabilidade (5), documentação (5). Autenticação **não vale pontos**: não deixe ela competir com o resto.

## Estrutura

Um único serviço NestJS (não é monorepo, não tem frontend).

```
src/
  domain/           → Money, Wallet, WagerTransaction, WalletLedgerEntry, InboxMessage, OutboxMessage, erros, FailureCode
  application/      → use cases, portas (repositories, UnitOfWork, Clock, IdGenerator), integration events
  infrastructure/   → MikroORM (schemas, migrations, repositories, mappers), SQS consumer, outbox publisher,
                      pending-reference worker, logs e métricas
  presentation/     → controllers HTTP, DTOs, health checks, AuthGuard
test/
  unit/             → domínio puro
  integration/      → PostgreSQL e LocalStack reais em containers
  concurrency/      → paralelismo real, ≥ 3 instâncias
docs/               → requirements.md, domain/, routes/, files-patterns/
OLD_README.md       → enunciado do desafio (fonte da verdade)
README.md           → README do projeto: setup e comandos (entregável, a criar)
ARCHITECTURE.md     → decisões, trade-offs e limitações (entregável, a criar)
```

## Comandos

```bash
bun install
bun run docker:up              # PostgreSQL + LocalStack (SQS) + app, espera tudo ficar saudável
bun run dev                   # app com watch
bun run migration:up          # aplica migrations
bun run migration:down        # reverte (migrations precisam ser reversíveis)
bun test                      # unitários
bun run test:integration      # requer containers
bun run test:concurrency      # requer containers
bun run test:load             # opcional (diferencial)
```

Subir o ambiente via Docker Compose não pode exigir passos manuais (criação das filas no LocalStack e migrations entram no compose ou no boot).

## Infra local

| Serviço     | Porta    | Observação |
|-------------|----------|------------|
| app         | `:3000`  | API HTTP + consumer SQS + workers |
| postgres    | `:5432`  | banco do serviço |
| localstack  | `:4566`  | SQS: `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e a fila de eventos de saída |

## Autenticação

Fica a critério do candidato (seção 2 do OLD_README). Se implementar, use um IdP externo (Keycloak ou Zitadel). **Nunca** crie tabela própria de usuários com hash de senha. Se não implementar, documente no `ARCHITECTURE.md` e deixe um ponto de extensão explícito (ex.: `AuthGuard` no-op). Os endpoints `/health/*` ficam sempre abertos. Mensagens da fila são canal interno confiável, mas a identidade do provedor na mensagem passa pelas mesmas validações de domínio.

## Regras invioláveis (OLD_README, seção 5)

1. **Dinheiro nunca em `number`/`float`/`double`.** Use o Value Object `Money`: contrato em string decimal com 2 casas (`"25.00"`), representação interna exata.
2. **Idempotência persistente**, nunca em memória: `UNIQUE (idempotency_key)` + `payloadHash`. Mesma key com payload diferente é **409**, não replay.
3. **Não confiar só no SQS FIFO** para consistência. Dedup e ordenação do broker são otimização; o banco garante as invariantes.
4. **Nenhum evento publicado antes do commit.** Use transactional outbox.
5. **Ledger append-only.** Nunca `UPDATE` nem `DELETE` em `wallet_ledger_entries` (bloquear também no banco).
6. **Sem lock global.** A unidade de concorrência é a `walletId`.
7. **Sem `read → calculate → update` sem controle de concorrência** (lock pessimista, optimistic locking com `version` ou update condicionado).
8. **Correto com múltiplas instâncias** (≥ 3).
9. **Unicidade, imutabilidade e não-negatividade garantidas no schema do banco** (constraints, CHECKs, índices, triggers), não só no código.
10. **TypeScript strict.** Não afrouxe `strict`, `noImplicitAny`, `strictNullChecks`. O `tsconfig` segue o recomendado pelo Bun (`verbatimModuleSyntax`): tipos e interfaces são importados com `import type`/`type` e reexportados com `export { type X }` — senão o Bun quebra em runtime com `emitDecoratorMetadata`.
11. **Commits atômicos e convencionais** (`feat(wallet): ...`, `fix(outbox): ...`).

## Stack

| Item | Escolha |
|---|---|
| Runtime / package manager / testes | **Bun 1.x** |
| Framework | **NestJS** + TypeScript strict |
| Banco | **PostgreSQL** |
| ORM | **MikroORM** (preferencial no OLD_README; TypeORM é aceito). **Prisma está fora do escopo.** |
| Mensageria | **AWS SQS via LocalStack** (ou MiniStack) |
| Orquestração | **Docker Compose** |
| Migrations | versionadas e **reversíveis** (`up` e `down`) |
| Base DDD | `ddd-tool-kit` (`Entity`, `Aggregate`, `ValueObject`, `Output`, `IError`) |
| Documentação da API | **Swagger / OpenAPI 3** via `@nestjs/swagger`, em `/docs` (UI) e `/docs/json`. Completa e bem apresentada: todos os status, exemplos nomeados, schemas e enums. Decorators explícitos (o plugin de CLI não roda no Bun). Requisitos em `docs/requirements.md` |

O domínio não depende de decorators do NestJS nem de tipos do ORM.

## Modelagem (OLD_README, seção 6)

- Construtor `private`/`protected` + factories estáticas: `create`/`from` (validam) e `rehydrate` (reconstrói do banco **sem** revalidar transições).
- `Money` é imutável; operações entre moedas diferentes lançam erro de domínio.
- `Wallet` é o aggregate root: saldo nunca negativo, uma por `playerId + currency`, `version` começa em 1 e só sobe quando o saldo muda.
- `WagerTransaction` tem estados `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`. Os três últimos são terminais: transicionar a partir deles lança erro.
- `WalletLedgerEntry` é uma entidade **filha da `Wallet`**, imutável por estrutura (sem setters e sem transições). Só existe repository para aggregate root: os lançamentos novos são salvos pelo `WalletRepository`.
- `InboxMessage` e `OutboxMessage` são aggregates de um só, no módulo `messaging` (mecanismo técnico, não negócio).
- Inbox, alteração financeira, ledger e outbox participam da **mesma transação SQL**.

Detalhes: `docs/requirements.md`. Classes de domínio (uma por arquivo, com código `ddd-tool-kit`): `docs/domain/` (comece por `docs/domain/shared.md`). Padrões de arquivo: `docs/files-patterns/`.

O `IdValueObject` do `ddd-tool-kit` só aceita ids de 16 caracteres (não UUID): nossos ids são `char(16)`, ids externos (`playerId`, `providerId`...) são `string`.

## Processamento

- HTTP `POST /wagering/transactions` e o consumer SQS chamam **o mesmo use case**.
- O consumer deduplica pela inbox `(consumerName, messageId)`, dá **ack só depois do commit** e separa erros de negócio (ack), transitórios (retry com backoff) e permanentes (DLQ). Em `SIGTERM`, termina o que está em andamento ou devolve a visibilidade.
- O outbox publisher roda em várias instâncias (`FOR UPDATE SKIP LOCKED`) e garante at-least-once.
- Transações `PENDING_REFERENCE` são reprocessadas por um worker agendado com backoff exponencial e limite definido.

Rotas e filas: uma rota por arquivo em `docs/routes/`. Comece por `docs/routes/shared.md`, que tem quem chama a API, as duas portas de entrada (HTTP e fila), as filas, o mapeamento de status HTTP e o formato de erro. Toda rota nova ou alterada também atualiza o Swagger.

## Testes

- **Unitários:** `Money` (escala, entradas inválidas, conflito de moeda), invariantes da `Wallet`, regras de `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`, idempotency key com payload divergente.
- **Integração** (PostgreSQL e LocalStack reais): migrations e constraints, atomicidade wallet/ledger/inbox/outbox, redelivery, publishers concorrentes, retry e DLQ, recuperação após restart.
- **Concorrência** (paralelismo real): mesma aposta 50× em paralelo, cenário 100.00 com duas apostas de 80.00, wallets distintas em paralelo, ≥ 3 instâncias, worker morto entre commit e ack, dois publishers na mesma outbox, `REFUND`/`ROLLBACK` antes da referência, restart.
- Invariante final de **todo** teste: `wallet.balance == saldo reconstruído pelo ledger`.
- Substituir PostgreSQL e SQS inteiramente por mocks é **eliminatório**.

## O que NÃO fazer

- Não usar Prisma, RabbitMQ, Kafka nem outro broker no lugar do SQS.
- Não publicar no SQS de dentro da transação de negócio. Só a outbox publica.
- Não abrir transação dentro de repository. Quem abre é o use case, via `UnitOfWork`.
- Não colocar regra de negócio em controller, consumer ou repository.
- Não gerar docs/summaries intermediários a menos que o usuário peça.
- Não usar `--no-verify` nem desativar hooks/lint.
- Não implementar features fora do OLD_README. MVP sólido > bônus frágil.
