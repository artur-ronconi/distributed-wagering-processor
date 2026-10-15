# Wallet Console

Console para **usar** o sistema como um operador de cassino e ver as regras de negócio acontecendo: abrir carteiras, apostar, ganhar, perder, reembolsar, estornar, reenviar pedidos e conferir o saldo contra o extrato.

## Rodar

```bash
bun run start                            # backend (na raiz)
bun run console                          # http://localhost:4001
```

Typecheck: `node_modules/.bin/tsc -p frontends/wallet-console/tsconfig.json`.

## O que tem

| Área | O que faz |
|---|---|
| Minhas carteiras | Cria quantas carteiras quiser. Cada uma ganha um `playerId` próprio (a regra é uma carteira por jogador + moeda) |
| Jogar | **Mesa livre**: aposta e você decide o resultado (ganhou, perdeu, reembolsar, estornar). **Cara ou coroa**: a moeda decide (WIN 2× ou LOSS) |
| Transações | Tudo o que foi enviado, inclusive rejeitadas e derrotas. **Reenviar** repete o pedido com a mesma `Idempotency-Key`; **Estornar** manda um ROLLBACK |
| Extrato | O ledger da carteira direto do backend, paginado por cursor |
| Laboratório | Experimentos que provocam cada regra (replay, 409, 422, 400, reversão única, concorrência, fora de ordem, estorno sem saldo) e um envio livre |
| Regras | Resumo das regras de negócio |
| Atividade (direita) | Cada requisição, o status e o que ele significou |

## "Não ver a carteira dos outros"

Não há login: cada **navegador** é um espaço. O console só guarda (no `localStorage`) e consulta as carteiras que criou, e não oferece busca por id. Outro navegador começa vazio. "Começar um espaço novo" esquece as carteiras locais (elas continuam no backend).

## Como fala com o backend

Só pela **API HTTP pública**, como qualquer cliente: o `server.ts` serve a página e repassa `/api/*` para `http://localhost:3000` (a API não tem CORS). Nada de leitura direta do banco ou das filas — para ver o que acontece por dentro, use o Flow Explorer.

O backend não tem rota para listar transações de uma carteira, então a aba Transações mostra o que **este console enviou**. Transações `PENDING_REFERENCE` são consultadas a cada 1,5s em `GET /providers/:providerId/wagering/transactions/:externalTransactionId` até o worker do backend resolvê-las.

LOSS é enviado sem `referenceExternalTransactionId`: hoje o backend só aceita referência em WIN, REFUND e ROLLBACK.

| Variável | Padrão |
|---|---|
| `CONSOLE_PORT` | `4001` |
| `CONSOLE_API_URL` | `http://localhost:3000` |
