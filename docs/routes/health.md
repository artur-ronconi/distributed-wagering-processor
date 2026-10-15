# GET /health/live e GET /health/ready — health checks

OLD_README §9 ("Health checks") e §12. Convenções em @docs/routes/shared.md.

As duas rotas ficam neste arquivo porque são simples e trabalham juntas. **Nenhuma exige autenticação**: elas ficam fora do `AuthGuard`, porque o orquestrador (Docker, Kubernetes, load balancer) não tem token.

## Diferença entre as duas

| | `/health/live` (liveness) | `/health/ready` (readiness) |
|---|---|---|
| Pergunta | "o processo está vivo?" | "posso receber tráfego agora?" |
| Verifica dependências? | **não** | sim: PostgreSQL e SQS |
| Se falhar, o orquestrador… | **reinicia** o processo | **para de mandar tráfego**, sem reiniciar |

A liveness **não pode** depender do banco. Se dependesse, uma queda do PostgreSQL faria o orquestrador reiniciar todas as instâncias em loop, e reiniciar não resolve banco fora do ar.

## GET /health/live

### 200 OK
```json
{ "status": "ok" }
```

Responde sempre que o processo consegue atender HTTP. Não faz I/O.

## GET /health/ready

Verifica cada dependência com **timeout curto** (ex.: 1s), em paralelo:

| Dependência | Verificação |
|---|---|
| `postgres` | `select 1` |
| `sqs` | `GetQueueAttributes` na `wager-transactions.fifo` (confirma que o LocalStack responde **e** que a fila existe) |

### 200 OK
```json
{
  "status": "ok",
  "checks": {
    "postgres": { "status": "up", "latencyMs": 3 },
    "sqs": { "status": "up", "latencyMs": 12 }
  }
}
```

### 503 Service Unavailable
```json
{
  "status": "error",
  "checks": {
    "postgres": { "status": "up", "latencyMs": 3 },
    "sqs": { "status": "down", "error": "timeout after 1000ms" }
  }
}
```

- O corpo de erro aqui **não** segue o formato padrão (`code`/`message`), porque o consumidor é o orquestrador, não um provedor. O que importa é o status HTTP.
- Não exponha strings de conexão, hosts internos nem stack traces no `error`.

### Durante o desligamento (SIGTERM)

Assim que recebe `SIGTERM`, a instância passa a responder `503` no `/health/ready` antes de parar. O load balancer deixa de mandar requisições novas enquanto ela termina as que estão em andamento (OLD_README §10: concluir ou devolver a visibilidade das mensagens). O `/health/live` continua `200` até o processo sair.

## Implementação

Com `@nestjs/terminus` (`HealthCheckService` e indicadores customizados para PostgreSQL via MikroORM e para SQS), ou um controller simples. Os dois atendem ao OLD_README.

```
src/shared/presentation/controllers/health.controller.ts
src/shared/presentation/controllers/dtos/health.dto.ts
src/shared/infrastructure/services/dependency-checks.ts             ← PostgreSQL e SQS, timeout de 1s
src/shared/infrastructure/services/shutdown-state.ts                ← flag lida pelo /health/ready no SIGTERM
```

O `docker-compose.yml` usa `/health/ready` no `healthcheck` do serviço da app, para os testes de integração só começarem quando tudo estiver de pé.

## Testes (integração)

- Com tudo de pé: os dois `200`.
- PostgreSQL parado: `/health/live` continua `200`, e `/health/ready` dá `503` com `postgres: down`.
- LocalStack parado ou fila inexistente: `/health/ready` dá `503` com `sqs: down`.
- Nenhuma das duas rotas pede token, mesmo com o `AuthGuard` ativo.
