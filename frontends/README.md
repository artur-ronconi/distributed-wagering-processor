# Frontends locais

Duas interfaces para entender o backend. As duas precisam dele no ar (`bun run start` na raiz).

| Pasta | Para quê | Comando | Endereço |
|---|---|---|---|
| [`wallet-console/`](wallet-console/README.md) | **Usar** o sistema como um operador: carteiras, apostas, vitórias, derrotas, reembolsos, estornos, extrato e experimentos com cada regra de negócio | `bun run console` | http://localhost:4001 |
| [`flow-explorer/`](flow-explorer/README.md) | **Ver por dentro**: anima o caminho de cada requisição no código (controller, use case, domínio, SQL, locks, outbox, filas) | `bun run explorer` | http://localhost:4000 |

O Wallet Console fala só com a API pública. O Flow Explorer também lê o Postgres, as filas e os logs, para mostrar o que aconteceu lá dentro.
