# Flow Explorer (visualizador local)

Executa as rotas e cenários do backend e anima, passo a passo, o caminho que cada execução percorreu no código.

## Rodar

```bash
bun run start                           # backend: app + Postgres + LocalStack (na raiz)
bun run explorer                        # http://localhost:4000
```

Não há passo de build: o `Bun.serve` empacota o `web/` sozinho. Typecheck: `node_modules/.bin/tsc -p frontends/flow-explorer/tsconfig.json`.

## Como o fluxo é obtido

O backend **não foi instrumentado**. O caminho é reconstruído a partir de evidências reais:

| Evidência | De onde vem |
|---|---|
| status, corpo e headers da resposta | proxy para a API (`/api/http`) |
| linhas antes/depois (wallet, transação, ledger, outbox, inbox) | leitura direta no Postgres (somente `SELECT`) |
| publicação da outbox | `published_at` das linhas da outbox |
| eventos publicados | este servidor consome `wagering-events.fifo` |
| veredito do consumer SQS (ack, DLQ, retry) | log `wager message handled` do container da app |

Cada passo indica se é **● observado** (confirmado por uma dessas evidências) ou **○ inferido** (o trecho de código implicado por elas). Os trechos de código são lidos do `src/` na hora, por âncora de texto, então acompanham as mudanças no backend. Se uma âncora sumir, o painel avisa.

## Efeitos colaterais

- Cria carteiras e transações no banco de desenvolvimento (`wagering`), nunca no de testes.
- Consome (lê e apaga) as mensagens de `wagering-events.fifo`. Para desligar: `FLOW_DRAIN_EVENTS=false`.
- A DLQ é só espiada (visibility 0): nada é removido de lá.

## Variáveis

| Variável | Padrão |
|---|---|
| `FLOW_UI_PORT` | `4000` |
| `FLOW_API_URL` | `http://localhost:3000` |
| `FLOW_DATABASE_URL` | `DATABASE_URL` ou `postgres://wagering:wagering@localhost:5433/wagering` |
| `FLOW_AWS_ENDPOINT_URL` | `AWS_ENDPOINT_URL` ou `http://localhost:4566` |
| `FLOW_DRAIN_EVENTS` | `true` |

## Estrutura

```
server.ts            Bun.serve: página + API local
server/              db (inspeção), sqs, logs do container, leitura do src/
web/flows/           catálogo de passos (código + explicação), reconstrução dos fluxos e cenários
web/ui/              diagrama SVG animado, player, painel de detalhe, formulários, resultados
```
