import type { StepDef } from "./types";

/** Backend files referenced by the steps (paths relative to the repository root). */
const F = {
  correlation: "src/shared/presentation/http/correlation-id.ts",
  guard: "src/shared/presentation/http/auth.guard.ts",
  pipe: "src/shared/presentation/http/validation.pipe.ts",
  filter: "src/shared/presentation/http/all-exceptions.filter.ts",
  httpError: "src/shared/presentation/http/http-error.ts",
  serviceFailure: "src/shared/errors/service-failure.ts",
  uow: "src/shared/infrastructure/database/mikro-orm.unit-of-work.ts",
  checks: "src/shared/infrastructure/services/dependency-checks.ts",
  health: "src/shared/presentation/controllers/health.controller.ts",
  migration: "src/shared/infrastructure/database/migrations/Migration20261014120000InitialSchema.ts",

  money: "src/modules/wallet/domain/aggregate/value-objects/money/money.value-object.ts",
  walletAgg: "src/modules/wallet/domain/aggregate/aggregate-root/wallet.aggregate-root.ts",
  ledgerEntry: "src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.entity.ts",
  walletRepo: "src/modules/wallet/infrastructure/database/repositories/mikro-orm.wallet.repository.ts",
  createWalletCtrl: "src/modules/wallet/presentation/controllers/create-wallet.controller.ts",
  createWalletUc: "src/modules/wallet/domain/usecases/create-wallet/create-wallet.usecase.ts",
  getWalletCtrl: "src/modules/wallet/presentation/controllers/get-wallet.controller.ts",
  getWalletUc: "src/modules/wallet/domain/usecases/get-wallet/get-wallet.usecase.ts",
  ledgerCtrl: "src/modules/wallet/presentation/controllers/get-wallet-ledger.controller.ts",
  ledgerUc: "src/modules/wallet/domain/usecases/get-wallet-ledger/get-wallet-ledger.usecase.ts",
  ledgerQuery: "src/modules/wallet/infrastructure/database/queries/mikro-orm.wallet-ledger.query.ts",
  reconcileCtrl: "src/modules/wallet/presentation/controllers/reconcile-wallet.controller.ts",
  reconcileUc: "src/modules/wallet/domain/usecases/reconcile-wallet/reconcile-wallet.usecase.ts",
  reconcileQuery: "src/modules/wallet/infrastructure/database/queries/mikro-orm.ledger-reconciliation.query.ts",
  balanceChanged: "src/modules/wallet/domain/events/wallet-balance-changed.event.ts",

  submitCtrl: "src/modules/wager-transaction/presentation/controllers/submit-wager-transaction.controller.ts",
  submitUc: "src/modules/wager-transaction/domain/usecases/submit-wager-transaction/submit-wager-transaction.usecase.ts",
  payloadHash: "src/modules/wager-transaction/domain/usecases/submit-wager-transaction/wager-payload-hash.ts",
  processor: "src/modules/wager-transaction/domain/usecases/process-wager-transaction/wager-transaction.processor.ts",
  txAgg: "src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.aggregate-root.ts",
  txRepo: "src/modules/wager-transaction/infrastructure/database/repositories/mikro-orm.wager-transaction.repository.ts",
  getTxCtrl: "src/modules/wager-transaction/presentation/controllers/get-wager-transaction.controller.ts",
  getTxUc: "src/modules/wager-transaction/domain/usecases/get-wager-transaction/get-wager-transaction.usecase.ts",
  providerCtrl: "src/modules/wager-transaction/presentation/controllers/get-provider-wager-transaction.controller.ts",
  providerUc:
    "src/modules/wager-transaction/domain/usecases/get-provider-wager-transaction/get-provider-wager-transaction.usecase.ts",
  consumer: "src/modules/wager-transaction/presentation/consumers/wager-transactions.consumer.ts",
  pendingConsumer: "src/modules/wager-transaction/presentation/consumers/pending-reference.consumer.ts",
  resolveUc:
    "src/modules/wager-transaction/domain/usecases/resolve-pending-references/resolve-pending-references.usecase.ts",
  processedEvent: "src/modules/wager-transaction/domain/events/wager-transaction-processed.event.ts",
  rejectedEvent: "src/modules/wager-transaction/domain/events/wager-transaction-rejected.event.ts",
  pendingEvent: "src/modules/wager-transaction/domain/events/wager-transaction-pending-reference.event.ts",

  inboxAgg: "src/modules/messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root.ts",
  inboxRepo: "src/modules/messaging/infrastructure/database/repositories/mikro-orm.inbox-message.repository.ts",
  outboxAgg: "src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root.ts",
  outboxRepo: "src/modules/messaging/infrastructure/database/repositories/mikro-orm.outbox-message.repository.ts",
  publishUc: "src/modules/messaging/domain/usecases/publish-outbox/publish-outbox.usecase.ts",
  publisherProducer: "src/modules/messaging/presentation/producers/outbox-publisher.producer.ts",
  sqsPublisher: "src/modules/messaging/infrastructure/services/sqs-event.publisher.ts",
};

const EVENT_FILE: Record<string, string> = {
  WagerTransactionProcessed: F.processedEvent,
  WagerTransactionRejected: F.rejectedEvent,
  WagerTransactionPendingReference: F.pendingEvent,
  WalletBalanceChanged: F.balanceChanged,
};

/** Reusable steps. Dynamic values (balances, ids, codes) go in the trace step's `note`. */
const S = {
  // ---------------------------------------------------------------- HTTP edge
  httpRequest: (method: string, path: string, controllerFile: string, anchor: string): StepDef => ({
    lane: "entry",
    from: "client",
    kind: "call",
    title: `${method} ${path}`,
    detail:
      "A requisição chega ao NestJS. O pino-http gera ou reaproveita o `X-Correlation-Id` (é ele que amarra todos os logs da requisição) e o Nest escolhe o controller pela rota.",
    code: { file: controllerFile, anchor },
  }),
  correlationId: {
    lane: "entry",
    kind: "call",
    title: "X-Correlation-Id",
    detail:
      "Reaproveita um `X-Correlation-Id` válido enviado pelo cliente ou cria um UUID, e devolve no header da resposta.",
    code: { file: F.correlation, anchor: "const correlationIdFor", span: 6 },
  } satisfies StepDef,
  authGuard: {
    lane: "entry",
    kind: "call",
    title: "AuthGuard (no-op)",
    detail:
      "Ponto de extensão da autenticação. Hoje deixa tudo passar (decisão documentada no ARCHITECTURE.md). Com um IdP, validaria o JWT aqui.",
    code: { file: F.guard, anchor: "canActivate(context", span: 4 },
  } satisfies StepDef,
  validationPipe: {
    lane: "entry",
    kind: "call",
    title: "ValidationPipe (DTO)",
    detail:
      "O `class-validator` confere o **formato** do corpo (tipos, campos obrigatórios, `amount` com 2 casas). Formato inválido vira `400 INVALID_PAYLOAD` e nada chega ao use case.",
    code: { file: F.pipe, anchor: "new ValidationPipe({", span: 5 },
  } satisfies StepDef,
  httpError: {
    lane: "entry",
    kind: "error",
    title: "httpErrorFrom → filtro global",
    detail:
      "O `Output` de falha do use case vira `HttpException` com o `statusCode` do erro de domínio. O filtro global monta o corpo padrão `{ code, message, correlationId }` (e o `Retry-After` no 503).",
    code: { file: F.filter, anchor: "catch(exception: unknown", span: 6 },
  } satisfies StepDef,
  exceptionFilter: {
    lane: "entry",
    kind: "error",
    title: "filtro global de exceções",
    detail:
      "O `ValidationPipe` lança `BadRequestException` antes do controller rodar. O filtro global monta o corpo padrão `{ code, message, correlationId }`.",
    code: { file: F.filter, anchor: "catch(exception: unknown", span: 6 },
  } satisfies StepDef,
  httpResponse: (status: number, controllerFile: string, anchor: string): StepDef => ({
    lane: "client",
    from: "entry",
    kind: status >= 400 ? "error" : "return",
    title: `HTTP ${status}`,
    detail: "Resposta enviada ao cliente.",
    code: { file: controllerFile, anchor },
  }),

  // ---------------------------------------------------------------- unit of work
  begin: (isolation = "READ COMMITTED", readOnly = false): StepDef => ({
    lane: "db",
    from: "usecase",
    kind: "db",
    title: `BEGIN${readOnly ? " READ ONLY" : ""}${isolation !== "READ COMMITTED" ? ` · ${isolation}` : ""}`,
    detail:
      "Quem abre a transação é o use case, via `UnitOfWork` (nunca o repository). Dentro dela, todos os repositories usam o mesmo fork do EntityManager. O `lock_timeout` impede que uma carteira muito disputada segure a requisição para sempre: estourou, vira `503`.",
    code: { file: F.uow, anchor: "return await this.em.transactional(", span: 5 },
    sql: `BEGIN${readOnly ? " READ ONLY" : ""};\nSET LOCAL lock_timeout = '5000ms';`,
  }),
  commit: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "COMMIT",
    detail:
      "Tudo o que foi escrito na transação vira permanente **junto**: ou entra tudo (transação, saldo, ledger, outbox, inbox) ou nada. É aqui que o lock da carteira é solto e que as FKs `DEFERRABLE` são checadas.",
    code: { file: F.uow, anchor: "return await this.em.transactional(" },
    sql: "COMMIT;",
  } satisfies StepDef,
  rollback: {
    lane: "db",
    from: "usecase",
    kind: "error",
    title: "ROLLBACK",
    detail:
      "Uma exceção dentro do callback desfaz a transação inteira. `AbortTransaction` é o jeito do use case dizer \"desfaça tudo e responda com este erro\": nada fica gravado.",
    code: { file: F.serviceFailure, anchor: "class AbortTransaction", span: 6 },
    sql: "ROLLBACK;",
  } satisfies StepDef,

  // ---------------------------------------------------------------- submit wager transaction
  submitController: {
    lane: "entry",
    kind: "call",
    title: "Idempotency-Key presente?",
    detail:
      "O header `Idempotency-Key` é obrigatório: sem ele não existe como reconhecer um reenvio. A HTTP e a fila SQS chamam **o mesmo use case** a partir daqui.",
    code: { file: F.submitCtrl, anchor: "if (!idempotencyKey?.trim())", span: 3 },
  } satisfies StepDef,
  submitExecute: {
    lane: "usecase",
    from: "entry",
    kind: "call",
    title: "SubmitWagerTransactionUseCase",
    detail:
      "Orquestra tudo. Se dois pedidos iguais correm em paralelo e um perde na constraint `UNIQUE`, a tentativa é refeita (até 3 vezes) e responde como replay.",
    code: { file: F.submitUc, anchor: "private async run(", span: 12 },
  } satisfies StepDef,
  prepare: {
    lane: "domain",
    from: "usecase",
    kind: "domain",
    title: "prepare(): Money + WagerTransaction.create",
    detail:
      "Validação pura, **antes** de abrir transação: `Money.from` exige exatamente 2 casas (sem arredondar) e o aggregate nasce `PENDING`. O `payloadHash` é o SHA-256 do JSON canônico dos campos de negócio: é ele que diferencia replay de conflito.",
    code: { file: F.submitUc, anchor: "const createMoney = MoneyValueObject.from(input.money)", span: 24 },
  } satisfies StepDef,
  idempotencyLookup: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "SELECT por idempotency_key",
    detail:
      "Caminho rápido: se a chave já existe, é um reenvio e nem precisa do lock da carteira. A garantia final é a constraint `wager_tx_idempotency_key_unique` no banco (idempotência persistente, nunca em memória).",
    code: { file: F.submitUc, anchor: "const existing = await this.transactions.findByIdempotencyKey", span: 2 },
    sql: "SELECT * FROM wager_transactions WHERE idempotency_key = $1;",
  } satisfies StepDef,
  replayCheck: {
    lane: "domain",
    from: "usecase",
    kind: "decision",
    title: "matchesPayload(payloadHash)",
    detail:
      "Mesma chave + mesmo payload → devolve o resultado **original** (`idempotentReplay: true`, sem mexer no saldo). Mesma chave + payload diferente → `409 IDEMPOTENCY_CONFLICT`.",
    code: { file: F.submitUc, anchor: "private replay(", span: 4 },
  } satisfies StepDef,
  lockWallet: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "SELECT … FOR UPDATE (wallet)",
    detail:
      "Trava **só a linha desta carteira** até o COMMIT. É a unidade de concorrência: carteiras diferentes processam em paralelo, a mesma carteira processa em fila. Sem lock global.",
    code: { file: F.walletRepo, anchor: "async findByIdForUpdate", span: 8 },
    sql: "SELECT * FROM wallets WHERE id = $1 FOR UPDATE;",
  } satisfies StepDef,
  recheckIdempotency: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "SELECT idempotency_key (de novo)",
    detail:
      "Um pedido idêntico pode ter feito COMMIT enquanto esperávamos o lock. Conferir de novo, já com o lock, evita processar duas vezes.",
    code: { file: F.submitUc, anchor: "const committedMeanwhile", span: 2 },
    sql: "SELECT * FROM wager_transactions WHERE idempotency_key = $1;",
  } satisfies StepDef,
  externalIdCheck: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "SELECT por providerId + externalTransactionId",
    detail:
      "O mesmo `externalTransactionId` não pode voltar com **outra** `Idempotency-Key`: seria a mesma operação com duas identidades. Garantido também pela constraint `wager_tx_provider_external_unique`.",
    code: { file: F.submitUc, anchor: "await this.transactions.findByExternalId(transaction.providerId", span: 3 },
    sql: "SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2;",
  } satisfies StepDef,
  decide: {
    lane: "domain",
    from: "usecase",
    kind: "call",
    title: "processor.decide(tx, wallet)",
    detail:
      "A regra de negócio central, compartilhada por HTTP, SQS e o worker de pendências. Decide e aplica **em memória**: devolve `processed`, `rejected` ou `reference-missing`.",
    code: { file: F.processor, anchor: "async decide(", span: 6 },
  } satisfies StepDef,
  checkPlayer: {
    lane: "domain",
    kind: "decision",
    title: "wallet.playerId === tx.playerId?",
    detail: "A carteira precisa ser do jogador informado na transação.",
    code: { file: F.processor, anchor: "if (wallet.playerId !== tx.playerId)" },
  } satisfies StepDef,
  checkCurrency: {
    lane: "domain",
    kind: "decision",
    title: "mesma moeda?",
    detail: "Operações entre moedas diferentes são proibidas pelo domínio.",
    code: { file: F.processor, anchor: "if (wallet.currency !== tx.money.currency)" },
  } satisfies StepDef,
  findReference: {
    lane: "db",
    from: "domain",
    kind: "db",
    title: "SELECT referência",
    detail:
      "WIN, REFUND e ROLLBACK apontam para outra transação (`referenceExternalTransactionId`). Se ela ainda não chegou (mensagens fora de ordem), o resultado é `reference-missing`.",
    code: { file: F.processor, anchor: "reference = await this.transactions.findByExternalId", span: 2 },
    sql: "SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2;",
  } satisfies StepDef,
  validateReference: {
    lane: "domain",
    from: "domain",
    kind: "decision",
    title: "tx.validateReference(reference)",
    detail:
      "A referência precisa ser de um tipo permitido, estar `PROCESSED` e ter o mesmo contexto (provedor, jogador, carteira, rodada e moeda). REFUND/ROLLBACK exigem o mesmo valor.",
    code: { file: F.txAgg, anchor: "validateReference(reference: WagerTransactionAggregate)", span: 18 },
  } satisfies StepDef,
  alreadyReversed: {
    lane: "db",
    from: "domain",
    kind: "db",
    title: "já foi revertida?",
    detail:
      "Uma aposta é revertida no máximo uma vez (REFUND e ROLLBACK somados). O índice único parcial `wager_tx_single_reversal` garante isso no banco mesmo sob corrida.",
    code: { file: F.txRepo, anchor: "async isAlreadyReversed", span: 7 },
    sql: "SELECT count(*) FROM wager_transactions\n WHERE reference_transaction_id = $1\n   AND kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED';",
  } satisfies StepDef,
  noBalanceEffect: {
    lane: "domain",
    from: "domain",
    kind: "decision",
    title: "LOSS: não mexe no saldo",
    detail: "Uma derrota só registra o resultado da rodada: a transação fica `PROCESSED` sem lançamento no ledger.",
    code: { file: F.processor, anchor: "if (!tx.affectsBalance())", span: 4 },
  } satisfies StepDef,
  direction: {
    lane: "domain",
    from: "domain",
    kind: "decision",
    title: "ledgerDirectionFor()",
    detail:
      "BET debita; WIN e REFUND creditam; ROLLBACK faz o **oposto** do que a referência fez (desfaz uma BET creditando).",
    code: { file: F.txAgg, anchor: "ledgerDirectionFor(reference?: WagerTransactionAggregate)", span: 16 },
  } satisfies StepDef,
  walletDebit: {
    lane: "domain",
    from: "domain",
    kind: "domain",
    title: "wallet.debit(money)",
    detail:
      "Saldo nunca fica negativo: se não cobre, falha com `INSUFFICIENT_FUNDS` (ou `REVERSAL_WOULD_OVERDRAW` num ROLLBACK). Se cobre, cria o lançamento do ledger **antes** de mudar o saldo, e a `version` sobe 1.",
    code: { file: F.walletAgg, anchor: "if (this.props.balance.isLessThan(money))", span: 3 },
  } satisfies StepDef,
  walletCredit: {
    lane: "domain",
    from: "domain",
    kind: "domain",
    title: "wallet.credit(money)",
    detail: "Cria o lançamento de CRÉDITO no ledger e soma ao saldo; a `version` sobe 1.",
    code: { file: F.walletAgg, anchor: "credit(money: MoneyValueObject, transactionId: IdValueObject)", span: 6 },
  } satisfies StepDef,
  ledgerEntry: {
    lane: "domain",
    from: "domain",
    kind: "domain",
    title: "WalletLedgerEntry.create",
    detail:
      "Entidade filha da Wallet, imutável. Só nasce se a conta fecha: `antes ± valor = depois` (o banco confere de novo com o CHECK `ledger_entry_is_balanced`).",
    code: { file: F.walletAgg, anchor: "private apply(direction", span: 22 },
  } satisfies StepDef,
  markProcessed: {
    lane: "domain",
    from: "domain",
    kind: "domain",
    title: "tx.markProcessed()",
    detail: "PENDING → PROCESSED, guardando o saldo observado. Estados terminais não aceitam nova transição.",
    code: { file: F.txAgg, anchor: "markProcessed(", span: 13 },
  } satisfies StepDef,
  reject: {
    lane: "domain",
    from: "domain",
    kind: "error",
    title: "tx.reject(code)",
    detail:
      "PENDING → REJECTED com o `failureCode`. A rejeição **é gravada** (é um resultado de negócio, auditável e idempotente): a resposta é `422` com o resultado no corpo.",
    code: { file: F.txAgg, anchor: "reject(code: FailureCode", span: 9 },
  } satisfies StepDef,
  referenceMissing: {
    lane: "domain",
    from: "domain",
    kind: "wait",
    title: "reference-missing → PENDING_REFERENCE",
    detail:
      "A referência ainda não existe. A transação é gravada como `PENDING_REFERENCE` e um worker tenta de novo com backoff exponencial (1s, 2s, 4s… até 60s, 10 tentativas). A resposta é `202`.",
    code: { file: F.submitUc, anchor: "transaction.markPendingReference(", span: 5 },
  } satisfies StepDef,
  buildEvents: {
    lane: "usecase",
    from: "domain",
    kind: "call",
    title: "monta os eventos de integração",
    detail:
      "Cada desfecho gera seus eventos: PROCESSED → `WagerTransactionProcessed` (+ `WalletBalanceChanged` se o saldo mudou); REJECTED → `WagerTransactionRejected`; PENDING_REFERENCE → `WagerTransactionPendingReference`.",
    code: { file: F.submitUc, anchor: "switch (decision.outcome)", span: 18 },
  } satisfies StepDef,
  insertTransaction: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "INSERT wager_transactions",
    detail:
      "Grava a transação com o desfecho. As constraints UNIQUE de `idempotency_key` e `(provider_id, external_transaction_id)` são a última linha de defesa contra duplicidade.",
    code: { file: F.submitUc, anchor: "await this.transactions.insert(transaction)" },
    sql: "INSERT INTO wager_transactions (...) VALUES (...);",
  } satisfies StepDef,
  updateWallet: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "UPDATE wallets … WHERE version = esperada",
    detail:
      "Update **condicionado** pela versão lida: se 0 linhas forem afetadas, alguém mudou a carteira no meio → `ConcurrencyConflictError` e a tentativa é refeita. Defesa extra além do `FOR UPDATE`.",
    code: { file: F.walletRepo, anchor: "const affected = await this.em.nativeUpdate(", span: 6 },
    sql: "UPDATE wallets SET balance_amount = $1, version = $2, updated_at = now()\n WHERE id = $3 AND version = $4;",
  } satisfies StepDef,
  insertLedger: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "INSERT wallet_ledger_entries",
    detail:
      "O ledger é **append-only**: só INSERT. Um trigger no banco (`wallet_ledger_entries_append_only`) recusa qualquer UPDATE ou DELETE.",
    code: { file: F.walletRepo, anchor: "await this.em.insertMany(", span: 4 },
    sql: "INSERT INTO wallet_ledger_entries (...) VALUES (...);",
  } satisfies StepDef,
  insertOutbox: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "INSERT outbox_messages",
    detail:
      "Transactional outbox: o evento é **gravado na mesma transação** do dinheiro, e não publicado. Se o COMMIT falhar, o evento some junto. Nenhum evento sai antes do commit.",
    code: { file: F.processor, anchor: "async enqueue(events", span: 9 },
    sql: "INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, next_attempt_at, ...)\nVALUES (...);",
  } satisfies StepDef,
  lockTimeout: {
    lane: "db",
    from: "usecase",
    kind: "error",
    title: "lock_timeout estourou",
    detail:
      "Outra transação segurou a carteira por mais de 5s. O erro é traduzido para transitório e a resposta é `503` com `Retry-After`: o cliente tenta de novo, nada foi gravado.",
    code: { file: F.serviceFailure, anchor: "if (error instanceof TransientInfrastructureError)", span: 4 },
  } satisfies StepDef,

  // ---------------------------------------------------------------- outbox publisher (async)
  publisherTick: {
    lane: "worker",
    from: "worker",
    kind: "async",
    title: "OutboxPublisher: tick",
    detail:
      "Um loop em cada instância (a cada 500ms, ou na hora se o lote veio cheio). Roda fora da requisição: o cliente já recebeu a resposta.",
    code: { file: F.publisherProducer, anchor: "protected async tick()", span: 4 },
  } satisfies StepDef,
  lockOutbox: {
    lane: "db",
    from: "worker",
    kind: "db",
    title: "SELECT … FOR UPDATE SKIP LOCKED",
    detail:
      "Várias instâncias publicam ao mesmo tempo sem pegar a mesma linha: quem chega depois **pula** as linhas travadas em vez de esperar.",
    code: { file: F.outboxRepo, anchor: "async lockDueBatch", span: 12 },
    sql: "BEGIN;\nSELECT * FROM outbox_messages\n WHERE published_at IS NULL AND next_attempt_at <= now()\n ORDER BY occurred_at, id LIMIT 50\n FOR UPDATE SKIP LOCKED;",
  } satisfies StepDef,
  sqsPublish: {
    lane: "sqs",
    from: "worker",
    kind: "async",
    title: "SendMessage wagering-events.fifo",
    detail:
      "Publica na fila FIFO de eventos: `MessageGroupId = aggregateId` (ordem por carteira/transação) e `MessageDeduplicationId = eventId`. A entrega é at-least-once: quem consome deduplica pelo `eventId`.",
    code: { file: F.sqsPublisher, anchor: "new SendMessageCommand({", span: 10 },
  } satisfies StepDef,
  markPublished: {
    lane: "db",
    from: "worker",
    kind: "db",
    title: "UPDATE published_at + COMMIT",
    detail:
      "Marca como publicado e solta os locks. Se o processo morrer entre o SendMessage e este COMMIT, outra instância publica de novo (por isso at-least-once).",
    code: { file: F.publishUc, anchor: "message.markPublished(DateValueObject.getDefault())", span: 2 },
    sql: "UPDATE outbox_messages SET published_at = now() WHERE id = $1;\nCOMMIT;",
  } satisfies StepDef,
  downstream: {
    lane: "client",
    from: "sqs",
    kind: "async",
    title: "consumidor downstream recebe",
    detail:
      "Este painel faz o papel de um sistema que consome os eventos: lê `wagering-events.fifo` e mostra o envelope recebido.",
  } satisfies StepDef,

  // ---------------------------------------------------------------- SQS consumer
  sqsSend: {
    lane: "sqs",
    from: "client",
    kind: "async",
    title: "SendMessage wager-transactions.fifo",
    detail:
      "O provedor publica na fila de entrada. `MessageGroupId = walletId` preserva a ordem por carteira; o `MessageDeduplicationId` só deduplica no broker por 5 minutos (otimização, não garantia).",
  } satisfies StepDef,
  sqsReceive: {
    lane: "entry",
    from: "sqs",
    kind: "async",
    title: "ReceiveMessage (long poll)",
    detail:
      "O consumer de cada instância faz long poll. A mensagem fica invisível para os outros enquanto é processada (visibility timeout).",
    code: { file: F.consumer, anchor: "new ReceiveMessageCommand({", span: 7 },
  } satisfies StepDef,
  sqsParse: {
    lane: "entry",
    kind: "decision",
    title: "parse() + InboxMessage.receive",
    detail:
      "Confere o envelope `WagerTransactionRequested`. O `messageId` do provedor (estável entre republicações) é a chave de deduplicação da inbox.",
    code: { file: F.consumer, anchor: "private parse(", span: 20 },
  } satisfies StepDef,
  sqsExecute: {
    lane: "usecase",
    from: "entry",
    kind: "call",
    title: "executeFromMessage(input, inbox)",
    detail: "O **mesmo** use case da rota HTTP, agora com a mensagem da inbox para registrar na mesma transação.",
    code: { file: F.consumer, anchor: "const output = await this.submitWagerTransaction.executeFromMessage(", span: 8 },
  } satisfies StepDef,
  inboxRegister: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "INSERT inbox … ON CONFLICT DO NOTHING",
    detail:
      "A inbox deduplica a entrega: se `(consumerName, messageId)` já existe, a mensagem já foi aplicada e só falta dar ack. Fica na **mesma transação** da alteração de saldo.",
    code: { file: F.inboxRepo, anchor: "async tryRegister(", span: 13 },
    sql: 'INSERT INTO inbox_messages (...) VALUES (...)\nON CONFLICT ("consumer_name", "message_id") DO NOTHING\nRETURNING "id";',
  } satisfies StepDef,
  inboxProcessed: {
    lane: "db",
    from: "usecase",
    kind: "db",
    title: "UPDATE inbox processed_at",
    detail: "Marca a mensagem como processada, ainda dentro da transação.",
    code: { file: F.submitUc, anchor: "inboxMessage.markProcessed(", span: 2 },
    sql: "UPDATE inbox_messages SET processed_at = now() WHERE id = $1;",
  } satisfies StepDef,
  sqsAck: {
    lane: "sqs",
    from: "entry",
    kind: "async",
    title: "DeleteMessage (ack)",
    detail:
      "Ack **só depois do commit**. Se o processo morrer antes daqui, o SQS reentrega e a inbox absorve a duplicata. Resultados de negócio (PROCESSED, REJECTED, PENDING, replay, duplicata) recebem ack.",
    code: { file: F.consumer, anchor: "private async ack(", span: 7 },
  } satisfies StepDef,
  sqsDlq: {
    lane: "sqs",
    from: "entry",
    kind: "error",
    title: "SendMessage DLQ + ack",
    detail:
      "Erro permanente que não gravou nada (mensagem malformada, payload inválido, conflito de chave, carteira inexistente): vai para `wager-transactions-dlq.fifo` com o `failureCode` como atributo, para auditoria.",
    code: { file: F.consumer, anchor: "private async sendToDlq(", span: 13 },
  } satisfies StepDef,
  sqsRetry: {
    lane: "sqs",
    from: "entry",
    kind: "wait",
    title: "ChangeMessageVisibility (retry)",
    detail:
      "Erro transitório: sem ack. A visibilidade cresce exponencialmente (2s, 4s, 8s…) e, depois de 5 recebimentos, a redrive policy manda para a DLQ.",
    code: { file: F.consumer, anchor: "private async backoff(", span: 10 },
  } satisfies StepDef,

  // ---------------------------------------------------------------- pending reference worker
  pendingTick: {
    lane: "worker",
    from: "worker",
    kind: "async",
    title: "PendingReferenceWorker: tick",
    detail: "Loop em cada instância (a cada 1s) que reprocessa transações `PENDING_REFERENCE` cuja próxima tentativa venceu.",
    code: { file: F.pendingConsumer, anchor: "protected async tick()", span: 4 },
  } satisfies StepDef,
  lockPending: {
    lane: "db",
    from: "worker",
    kind: "db",
    title: "SELECT pendente … FOR UPDATE SKIP LOCKED",
    detail: "Uma transação pequena por item. `SKIP LOCKED` divide o trabalho entre instâncias.",
    code: { file: F.resolveUc, anchor: "const [tx] = await this.transactions.lockDuePendingReferences(now, 1)", span: 2 },
    sql: "BEGIN;\nSELECT * FROM wager_transactions\n WHERE status = 'PENDING_REFERENCE' AND next_reference_attempt_at <= now()\n ORDER BY next_reference_attempt_at LIMIT 1\n FOR UPDATE SKIP LOCKED;",
  } satisfies StepDef,
  workerLockWallet: {
    lane: "db",
    from: "worker",
    kind: "db",
    title: "SELECT wallet … FOR UPDATE",
    detail: "O worker trava a carteira exatamente como a rota HTTP.",
    code: { file: F.resolveUc, anchor: "const wallet = await this.wallets.findByIdForUpdate(tx.walletId)" },
    sql: "SELECT * FROM wallets WHERE id = $1 FOR UPDATE;",
  } satisfies StepDef,
  workerDecide: {
    lane: "domain",
    from: "worker",
    kind: "call",
    title: "processor.decide(tx, wallet)",
    detail: "Mesmas regras da rota HTTP e da fila.",
    code: { file: F.resolveUc, anchor: "const decision = await this.processor.decide(tx, wallet, now)" },
  } satisfies StepDef,
  scheduleRetry: {
    lane: "domain",
    from: "domain",
    kind: "wait",
    title: "scheduleReferenceRetry()",
    detail:
      "A referência ainda não chegou: soma uma tentativa e agenda a próxima com backoff exponencial. Depois de 10 tentativas vira `REJECTED` com `REFERENCE_NOT_FOUND`.",
    code: { file: F.resolveUc, anchor: "if (tx.referenceAttempts + 1 >= maxAttempts)", span: 8 },
  } satisfies StepDef,
  workerSave: {
    lane: "db",
    from: "worker",
    kind: "db",
    title: "UPDATE wager_transactions",
    detail: "Grava o novo estado da transação pendente.",
    code: { file: F.resolveUc, anchor: "await this.transactions.save(tx)" },
    sql: "UPDATE wager_transactions SET status = $1, reference_attempts = $2, ... WHERE id = $3;",
  } satisfies StepDef,
} as const;

export { EVENT_FILE, F, S };
