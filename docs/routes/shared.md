# Rotas — convenções compartilhadas

OLD_README §9. O `OLD_README.md` é a fonte da verdade. Domínio em @docs/domain/shared.md, padrões de arquivo em @docs/files-patterns/.

## Rotas

| Método | Rota | Arquivo | Auth |
|---|---|---|---|
| `POST` | `/wallets` | @docs/routes/create-wallet.md | sim* |
| `GET` | `/wallets/:walletId` | @docs/routes/get-wallet.md | sim* |
| `GET` | `/wallets/:walletId/ledger` | @docs/routes/get-wallet-ledger.md | sim* |
| `POST` | `/wallets/:walletId/reconciliation` | @docs/routes/reconcile-wallet.md | sim* |
| `POST` | `/wagering/transactions` | @docs/routes/submit-wager-transaction.md | sim* |
| `GET` | `/wagering/transactions/:transactionId` | @docs/routes/get-wager-transaction.md | sim* |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | @docs/routes/get-provider-wager-transaction.md | sim* |
| `GET` | `/health/live` e `/health/ready` | @docs/routes/health.md | **nunca** |

\* A autenticação fica a critério do candidato (OLD_README §2). Todas essas rotas passam por um `AuthGuard`. Se a decisão for não implementar, o guard é no-op e a decisão vai para o `ARCHITECTURE.md`. Os health checks ficam sempre fora do guard.

## Quem chama esta API

O "usuário" desta API **não é o jogador**. Quem chama são os **provedores de jogos** (ex.: o sistema do Fortune Chimp) e, para criar carteiras, o backend do cassino. O jogador nunca chama este serviço diretamente: o jogo que ele está jogando é que chama. O desafio não tem frontend.

**Todas as rotas são HTTP diretas.** O OLD_README não exige API gateway na frente.

## Duas portas de entrada para a mesma operação

A fila **não é uma camada na frente da API**. Ela é uma **segunda porta de entrada**, paralela ao HTTP, e serve **para uma única operação**: enviar transações de aposta. As duas portas chegam ao **mesmo use case**. Todas as outras rotas são só HTTP.

```
                        ┌─────────────── HTTP (direto) ────────────────┐
                        │  POST /wallets                               │
                        │  GET  /wallets/:id, /ledger, /transactions…  │
 Provedor / Cassino ────┤  POST /wallets/:id/reconciliation            ├──► nosso serviço
                        │  POST /wagering/transactions ────┐           │
                        └──────────────────────────────────┼───────────┘
                                                           ▼
                                             SubmitWagerTransactionService
                                                           ▲
 Provedor ──► SQS wager-transactions.fifo ──► Consumer ────┘
                         │
                         └─(falha permanente)─► wager-transactions-dlq.fifo
```

| | HTTP `POST /wagering/transactions` | Fila `wager-transactions.fifo` |
|---|---|---|
| Estilo | **síncrono**: o provedor espera a resposta | **assíncrono**: o provedor manda e segue a vida |
| O que recebe de volta | na hora: `status`, `balance`, `idempotentReplay` | nada. Descobre o resultado pelos eventos publicados ou por `GET /providers/.../:externalTransactionId` |
| Se o serviço estiver fora do ar | recebe erro e precisa tentar de novo | a mensagem **espera na fila** até o serviço voltar |
| Bom para | quando o jogo precisa saber o saldo na hora (ex.: antes de liberar a rodada) | volume alto, ou operações que podem ser processadas um pouco depois (ex.: WIN/LOSS no fim da rodada) |

O contrato da mensagem e o que acontece com ela em cada resultado (ack, retry ou DLQ) estão em @docs/routes/submit-wager-transaction.md.

## Filas

Não existe uma fila por rota:

```
wager-transactions.fifo        ← entrada das transações de aposta (OLD_README §10)
wager-transactions-dlq.fifo    ← mensagens que falharam de vez (dead-letter queue)
wagering-events.fifo (nome nosso) ← saída: o outbox publisher publica os eventos de integração aqui
```

As outras rotas não têm fila, por dois motivos:

- **GETs não funcionam por fila.** Uma fila não devolve resposta, e quem consulta precisa do dado na hora.
- **Criar carteira e reconciliar** são operações raras e administrativas. Não precisam de processamento assíncrono, e o OLD_README não pede.

Todas as filas são criadas automaticamente quando o Docker Compose sobe (script de init do LocalStack). Subir o ambiente não pode exigir passo manual.

## Status HTTP (o mesmo mapeamento em todas as rotas)

O OLD_README exige distinguir, de forma consistente: payload inválido, conflito de idempotência, rejeição de negócio, aceite pendente e falha transitória. O provedor decide se reenvia **só pelo status**.

| Situação | Status | Pode reenviar? |
|---|---|---|
| Criado / processado agora | `201 Created` | não precisa |
| Consulta ok, replay idempotente, reconciliação | `200 OK` | — |
| Aceito, aguardando referência (`PENDING_REFERENCE`) | `202 Accepted` | não. Consulte depois |
| Payload inválido (`INVALID_PAYLOAD`, `INVALID_AMOUNT`) | `400 Bad Request` | só depois de corrigir |
| Não encontrado (`WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`) | `404 Not Found` | só depois de corrigir |
| Conflito (`IDEMPOTENCY_CONFLICT`, `WALLET_ALREADY_EXISTS`) | `409 Conflict` | não igual |
| Rejeição de negócio (`INSUFFICIENT_FUNDS`, `REFERENCE_*`...) | `422 Unprocessable Entity` | não. O resultado não muda |
| Falha transitória (banco ou SQS fora, lock timeout) | `503 Service Unavailable` + `Retry-After` | **sim, com a mesma key** |
| Erro inesperado (bug) | `500 Internal Server Error` | sim, com a mesma key |

Taxonomia completa dos códigos em @docs/domain/shared.md.

## Formato de erro

Toda resposta de erro tem o mesmo corpo:

```json
{
  "code": "WALLET_NOT_FOUND",
  "message": "Wallet does not exist.",
  "correlationId": "c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f"
}
```

- `code` é o `failureCode` estável (`IDomainError.code`). É o campo que o provedor usa para decidir. A `message` é só para humanos.
- Exceção: `POST /wagering/transactions` com `REJECTED` devolve o **resultado da transação** (com `failureCode`), não esse corpo. Ver @docs/routes/submit-wager-transaction.md.
- Erros de validação do Nest (`ValidationPipe`) também saem nesse formato, com `code: "INVALID_PAYLOAD"`. Configurar `exceptionFactory` no pipe global.
- Erro inesperado: `code: "INTERNAL_ERROR"`, sem stack trace nem detalhes internos no corpo. O detalhe vai para o log.

## Headers

| Header | Direção | Uso |
|---|---|---|
| `Idempotency-Key` | request | **obrigatório** em `POST /wagering/transactions`. Fonte da verdade da idempotência |
| `X-Correlation-Id` | request e response | opcional na entrada. Se não vier, o serviço gera um. Sempre devolvido na resposta e presente em todos os logs e eventos da requisição |
| `Retry-After` | response | em `503`, segundos sugeridos até tentar de novo |
| `Authorization` | request | `Bearer <token>`, se a autenticação for implementada |

## Formatos

- **Dinheiro:** sempre `{ "amount": "25.00", "currency": "BRL" }`. String com exatamente 2 casas, nunca número (@docs/domain/money.md).
- **Ids nossos** (`walletId`, `transactionId`, ids de lançamento): 16 caracteres gerados pelo `IdValueObject` do `ddd-tool-kit`, ex.: `4f1c2a9be07d3e58`. Id com outro formato na URL → `400 INVALID_PAYLOAD`.
- **Ids externos** (`playerId`, `providerId`, `externalTransactionId`, `roundId`, `gameId`): string não vazia, até 128 caracteres.
- **Datas:** ISO-8601 em UTC, ex.: `2026-07-29T15:00:00.000Z`.

## Estrutura de arquivos por rota

Seguindo @docs/files-patterns/controller.md e @docs/files-patterns/service.md, cada rota tem um controller e um service próprios:

```
src/presentation/http/<recurso>/
  <acao>.controller.ts          ← só traduz HTTP ⇄ service
  <acao>.request.dto.ts         ← formato do body (class-validator)
  <acao>.response.dto.ts
src/application/use-cases/<acao>/
  <acao>.service.ts             ← regra de orquestração, abre a transação
  <acao>.input.ts
  <acao>.output.ts
```

## Validação: DTO × domínio

- O **DTO** (class-validator) confere só a **forma**: campos presentes, tipos string/objeto, tamanho máximo.
- O **domínio** confere o **conteúdo**: formato do dinheiro (`MoneyValueObject.from`), kind permitido, referência obrigatória etc.

Assim cada regra existe num lugar só, e o consumer SQS (que não passa pelo DTO do Nest) recebe as mesmas validações de conteúdo.

## Observabilidade em todas as rotas

- Log JSON por requisição com `correlationId`, rota, status, latência e, quando houver, `walletId`, `transactionId`, `providerId`. Sem payload financeiro completo.
- Métrica de latência por rota e de respostas por status.
