# POST /wagering/transactions — enviar transação de aposta

OLD_README §7, §8, §9 ("Submeter transação") e §10. Convenções em @docs/routes/shared.md. Domínio: @docs/domain/wager-transaction.md e @docs/domain/wallet.md.

## Papel

A rota principal do serviço. O provedor envia um `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK`, e o serviço aplica na carteira com idempotência, controle de concorrência por carteira, ledger e outbox, tudo numa única transação SQL.

A mesma operação também pode chegar pela fila `wager-transactions.fifo`. As duas entradas usam **o mesmo** `SubmitWagerTransactionService` (seção "Mesma operação via SQS").

## Request

```http
POST /wagering/transactions
Content-Type: application/json
Idempotency-Key: provider-a:transaction-123
X-Correlation-Id: c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f   (opcional)
```

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "4f1c2a9be07d3e58",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

`REFUND` e `ROLLBACK` também mandam `"referenceExternalTransactionId": "transaction-100"` (o id **do provedor** da transação referenciada). `WIN` pode mandar, apontando para a `BET`.

| Campo | Regra |
|---|---|
| header `Idempotency-Key` | **obrigatório**, string não vazia, até 256 caracteres. Padrão recomendado: `"{providerId}:{externalTransactionId}"` |
| `providerId`, `externalTransactionId`, `playerId`, `roundId`, `gameId` | string não vazia, até 128 caracteres |
| `walletId` | id de 16 caracteres |
| `kind` | `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK`. `OPENING` é recusado |
| `money` | formato de @docs/domain/money.md. Positivo, exceto `LOSS`, que aceita `0.00` |
| `referenceExternalTransactionId` | obrigatório em `REFUND` e `ROLLBACK` |

## payloadHash

Hash do conteúdo de negócio, usado para distinguir **replay** de **conflito**. Mora na camada application (`canonical-payload-hash.ts`):

1. Pegar **só** os campos de negócio: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money` (`amount`, `currency`) e `referenceExternalTransactionId` (se vier).
2. **Não** entram: o header `Idempotency-Key`, `X-Correlation-Id`, `messageId`, `occurredAt` nem qualquer metadado de transporte.
3. Serializar como **JSON canônico**: chaves em ordem alfabética em todos os níveis, sem espaços, campos ausentes omitidos.
4. `SHA-256` do resultado, em hexadecimal (64 caracteres).

```ts
import { createHash } from "node:crypto";

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const payloadHash = (fields: WagerBusinessFields): string =>
  createHash("sha256").update(canonicalize(fields)).digest("hex");
```

Como HTTP e SQS montam o hash a partir dos mesmos campos, a mesma operação gera o mesmo hash pelos dois caminhos. Documentar o algoritmo no `ARCHITECTURE.md`.

## Fluxo

O passo a passo de domínio está em @docs/domain/wager-transaction.md (seção "Uso"). Aqui fica a parte da rota:

```
SubmitWagerTransactionController
  1. lê Idempotency-Key (ausente → 400) e o body (DTO)
  2. service.execute({ ...body, idempotencyKey, correlationId })
SubmitWagerTransactionService
  3. payloadHash
  4. uow.transactional:
       a. idempotência: busca por idempotency_key
            existe + mesmo hash      → resultado original (replay)
            existe + hash diferente  → 409 IDEMPOTENCY_CONFLICT
       b. MoneyValueObject.from + WagerTransactionAggregate.create → 400
       c. walletRepository.findByIdForUpdate (lock só desta carteira) → 404 WALLET_NOT_FOUND
       d. referência (REFUND/ROLLBACK/WIN com ref): resolve, valida ou deixa PENDING_REFERENCE
       e. aplica: wallet.debit / wallet.credit / nada (LOSS) → markProcessed ou reject
       f. grava a transação, a carteira (se mudou, com o lançamento novo) e a outbox
     COMMIT
       UNIQUE (idempotency_key) violada → rollback, relê a vencedora e responde como replay
  5. mapeia o resultado para o status HTTP
```

### Concorrência

- O lock é `SELECT ... FOR UPDATE` na linha da carteira (passo c). Apostas na mesma carteira fazem fila. Carteiras diferentes rodam em paralelo.
- `walletRepository.save` atualiza com `WHERE version = expectedVersion` como segunda proteção.
- Cenário obrigatório (OLD_README §8): saldo `100.00` e duas `BET` de `80.00` simultâneas resultam em uma `201 PROCESSED`, uma `422 REJECTED INSUFFICIENT_FUNDS`, saldo `20.00` e um único lançamento `DEBIT`.
- 50 envios iguais em paralelo: o `UNIQUE (idempotency_key)` deixa só um inserir, e os outros 49 respondem replay. Um único débito.

## Responses

O corpo de sucesso, de rejeição e de replay é **o mesmo formato**: o resultado da transação.

```json
{
  "transactionId": "9a7e0c3d51b2f846",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "failureCode": null,
  "idempotentReplay": false
}
```

- `balance` é o saldo **observado no momento da decisão** (`observedBalance` da transação). No replay vem o saldo daquela época, não o atual (OLD_README §7, regra 7).
- `failureCode` só vem preenchido em `REJECTED`.
- Em `PENDING_REFERENCE`, `balance` é `null`, porque nada foi decidido ainda.

| Situação | Status | `status` no corpo | `idempotentReplay` |
|---|---|---|---|
| Processada agora | `201` | `PROCESSED` | `false` |
| Rejeitada agora (regra de negócio) | `422` | `REJECTED` + `failureCode` | `false` |
| Aguardando referência | `202` | `PENDING_REFERENCE` | `false` |
| Replay de `PROCESSED` | `200` | `PROCESSED` | `true` |
| Replay de `REJECTED` | `422` | `REJECTED` + `failureCode` | `true` |
| Replay de algo ainda pendente | `202` | `PENDING_REFERENCE` | `true` |
| Replay de algo pendente que já foi resolvido | conforme o estado atual (`200` ou `422`) | `PROCESSED` ou `REJECTED` | `true` |

### Erros (corpo de erro padrão, nenhuma transação gravada)

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | sem `Idempotency-Key`, campo faltando, `kind` inválido ou `OPENING`, dinheiro mal formatado, `REFUND`/`ROLLBACK` sem referência |
| 400 | `INVALID_AMOUNT` | valor zero em kind que mexe no saldo |
| 404 | `WALLET_NOT_FOUND` | `walletId` não existe |
| 409 | `IDEMPOTENCY_CONFLICT` | mesma `Idempotency-Key` com `payloadHash` diferente |
| 503 | `TRANSIENT_FAILURE` | banco indisponível, timeout de lock. Reenviar com a **mesma** key |

### Rejeições (transação gravada como `REJECTED`, status 422)

`WALLET_PLAYER_MISMATCH`, `CURRENCY_MISMATCH`, `INSUFFICIENT_FUNDS`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_KIND_NOT_ALLOWED`, `REFERENCE_MISMATCH`, `REFERENCE_AMOUNT_MISMATCH`, `REFERENCE_NOT_PROCESSED`, `REFERENCE_ALREADY_REVERSED`. Depois do limite de tentativas, uma transação `PENDING_REFERENCE` vira `REJECTED` com `REFERENCE_NOT_FOUND` (pelo worker, não por esta rota).

## Mesma operação via SQS

Fila `wager-transactions.fifo`, mensagem do OLD_README §10:

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "4f1c2a9be07d3e58",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

O consumer registra a inbox (@docs/domain/inbox-message.md), chama o **mesmo** service dentro da mesma transação e só dá o ack depois do commit. O resultado do service decide o que fazer com a mensagem:

| Resultado do service | Ação na fila | Por quê |
|---|---|---|
| `PROCESSED`, `REJECTED`, `PENDING_REFERENCE`, replay | **ack** | resultado definitivo gravado no banco |
| inbox já tinha o `messageId` | **ack** | redelivery de algo já processado |
| `INVALID_PAYLOAD`, `INVALID_AMOUNT`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND` | **DLQ** | erro permanente que não foi gravado. Na DLQ fica auditável em vez de sumir |
| `TRANSIENT_FAILURE` ou erro inesperado | **sem ack** | volta depois do visibility timeout. Após `maxReceiveCount` tentativas, a redrive policy manda para `wager-transactions-dlq.fifo` |

`MessageGroupId = walletId` ordena as mensagens da mesma carteira dentro do SQS, mas é só otimização. A correção vem do lock e das constraints do banco.

## Arquivos

```
src/presentation/http/wagering/submit-wager-transaction.controller.ts
src/presentation/http/wagering/submit-wager-transaction.request.dto.ts
src/presentation/http/wagering/wager-transaction-result.response.dto.ts
src/presentation/sqs/wager-transactions.consumer.ts
src/application/use-cases/submit-wager-transaction/submit-wager-transaction.service.ts
src/application/use-cases/submit-wager-transaction/submit-wager-transaction.input.ts
src/application/use-cases/submit-wager-transaction/submit-wager-transaction.output.ts
src/application/idempotency/canonical-payload-hash.ts
```

### submit-wager-transaction.output.ts
```ts
import { MoneyProps } from "../../../domain/money/money.props";
import { FailureCode } from "../../../domain/shared/failure-code";
import { WagerTransactionStatus } from "../../../domain/wager-transaction/wager-transaction.enums";

interface ISubmitWagerTransactionServiceOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps | null;
  failureCode: FailureCode | null;
  idempotentReplay: boolean;
}

export { ISubmitWagerTransactionServiceOutput };
```

### Status no controller (depende do resultado)
`MISSING_IDEMPOTENCY_KEY` fica em `src/application/use-cases/submit-wager-transaction/submit-wager-transaction.errors.ts` (`code: FailureCode.InvalidPayload`, `400`).

```ts
@Post()
async execute(
  @Headers("idempotency-key") idempotencyKey: string | undefined,
  @Body() body: SubmitWagerTransactionRequestDto,
  @Res({ passthrough: true }) response: Response,
) {
  if (!idempotencyKey?.trim()) throw getCorrectNestjsErrorByOutput(Output.fail(MISSING_IDEMPOTENCY_KEY));

  const output = await this.service.execute({ ...body, idempotencyKey, correlationId });
  if (output.isFailure) throw getCorrectNestjsErrorByOutput(output);

  const result = output.result as ISubmitWagerTransactionServiceOutput;
  response.status(statusFor(result));
  return result;
}

const statusFor = ({ status, idempotentReplay }: ISubmitWagerTransactionServiceOutput): number => {
  if (status === WagerTransactionStatus.Rejected) return HttpStatus.UNPROCESSABLE_ENTITY;
  if (status === WagerTransactionStatus.PendingReference) return HttpStatus.ACCEPTED;
  return idempotentReplay ? HttpStatus.OK : HttpStatus.CREATED;
};
```

## Testes

Integração e concorrência com PostgreSQL e LocalStack reais (OLD_README §13):

- Cada kind no caminho feliz: saldo, ledger, status e eventos na outbox corretos. `LOSS` sem lançamento e sem `WalletBalanceChanged`.
- Replay idêntico: mesmo corpo, `idempotentReplay: true`, saldo da época mesmo depois de outras apostas.
- Mesma key com valor diferente: `409`, nada gravado.
- Saldo `100.00` e duas `BET` de `80.00` simultâneas: uma `201` e uma `422`, saldo `20.00`, um `DEBIT`.
- Mesma `BET` 50 vezes em paralelo: um débito, 49 replays.
- `ROLLBACK` antes da `BET`: `202`. Depois que a `BET` chega e o worker roda, o `ROLLBACK` vira `PROCESSED`.
- `ROLLBACK` que deixaria o saldo negativo: `422 REVERSAL_WOULD_OVERDRAW`, diferente de `INSUFFICIENT_FUNDS`.
- `REFUND` duas vezes da mesma `BET` (keys diferentes): o segundo dá `422 REFERENCE_ALREADY_REVERSED`.
- Banco fora do ar: `503` com `Retry-After`.
- Via SQS: a mesma mensagem duas vezes gera um efeito só. Uma mensagem inválida vai para a DLQ.
- Ao final de cada teste: `wallet.balance == saldo reconstruído pelo ledger`.
