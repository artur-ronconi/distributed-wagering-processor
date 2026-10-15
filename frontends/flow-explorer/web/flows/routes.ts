import { api, type HttpExchange } from "../api";
import { session } from "../state";
import { followOutbox } from "./async";
import { F, S } from "./catalog";
import { emitDecision, emitPersist } from "./decision";
import { STATUS_FOR } from "./submit";
import { byEmitOrder, invariantNote, money, walletLine } from "./format";
import type { Extra, RunContext } from "./sink";
import type { StepDef } from "./types";

const isDtoError = (exchange: HttpExchange) =>
  exchange.status === 400 && / must | should /.test(String(exchange.body?.message ?? ""));

const respond = (ctx: RunContext, exchange: HttpExchange, file: string, anchor: string, note?: string) => {
  if (exchange.status >= 400) {
    const last = ctx.trace.steps.at(-1);
    const def = last?.title === S.validationPipe.title ? S.exceptionFilter : S.httpError;
    ctx.trace.add({ ...def, from: last?.lane === "entry" ? "entry" : "usecase" }, {
      note: `${exchange.body?.code}: ${exchange.body?.message}`,
      evidence: "observado",
      outcome: "fail",
    });
  }
  ctx.trace.add(S.httpResponse(exchange.status, file, anchor), {
    note: note ?? (exchange.body?.code ? String(exchange.body.code) : `${exchange.durationMs} ms`),
    evidence: "observado",
    data: exchange.body,
    outcome: exchange.status >= 400 ? "fail" : "ok",
  });
};

const readBegin = (isolation = "READ COMMITTED"): StepDef => ({
  ...S.begin(isolation, true),
  detail:
    isolation === "REPEATABLE READ"
      ? "Aqui a transação **é necessária**: são duas leituras (saldo e soma do ledger) e o `REPEATABLE READ` faz as duas enxergarem o mesmo instante. Sem isso, uma aposta que fizesse commit entre elas geraria uma falsa divergência."
      : "Para uma leitura simples a transação não protege nada: ela existe para obter um contexto do MikroORM, porque `allowGlobalContext: false` proíbe usar o EntityManager global fora de um fork.",
});

const idCheck = (file: string, value: string): StepDef => ({
  lane: "domain",
  from: "usecase",
  kind: "decision",
  title: "IdValueObject.init (16 caracteres)",
  detail: `Os ids internos têm exatamente 16 caracteres (\`char(16)\`). Um id malformado é \`400\` sem tocar no banco. Valor recebido: \`${value}\`.`,
  code: { file, anchor: "IdValueObject.init({ value: input." },
});

// ------------------------------------------------------------------ POST /wallets

interface CreateWalletInput {
  playerId: string;
  amount: string;
  currency: string;
}

const runCreateWallet = async (ctx: RunContext, input: CreateWalletInput, options: { title?: string; track?: string } = {}) => {
  const { trace } = ctx;
  const add = (def: StepDef, extra: Extra = {}) => trace.add(def, { track: options.track, ...extra });

  const before = await api.inspect({ playerId: input.playerId, currency: input.currency });
  const exchange = await api.http("POST", "/wallets", {
    body: { playerId: input.playerId, initialBalance: { amount: input.amount, currency: input.currency } },
  });
  const walletId: string | undefined = exchange.body?.id;
  const after = await api.inspect(
    walletId ? { walletId, openingOfWallet: walletId } : { playerId: input.playerId, currency: input.currency },
  );
  ctx.record({ type: "http", title: options.title ?? "POST /wallets", exchange, track: options.track });
  const finish = () => {
    respond(ctx, exchange, F.createWalletCtrl, "const output = await this.createWallet.execute");
    return { exchange, after };
  };

  add(S.httpRequest("POST", "/wallets", F.createWalletCtrl, "@Post()"), {
    note: `${input.playerId} · ${money(input.amount, input.currency)}`,
    evidence: "observado",
    data: exchange.request,
  });
  add(S.authGuard, {});
  const dtoError = isDtoError(exchange);
  add(S.validationPipe, {
    branch: { question: "formato do corpo válido?", answer: dtoError ? "não" : "sim" },
    outcome: dtoError ? "fail" : "ok",
  });
  if (dtoError) return finish();

  add(
    {
      lane: "usecase",
      from: "entry",
      kind: "call",
      title: "CreateWalletUseCase",
      detail: "Cria a carteira. Um saldo inicial positivo também cria a transação interna OPENING e o lançamento de CRÉDITO, na mesma transação SQL.",
      code: { file: F.createWalletUc, anchor: "async execute(input", span: 8 },
    },
    {},
  );

  const invalidMoney = exchange.status === 400;
  add(
    {
      lane: "domain",
      from: "usecase",
      kind: "decision",
      title: "Money.from(initialBalance)",
      detail: "Dinheiro nunca é `number`: o valor é string com exatamente 2 casas, guardado internamente como `bigint` em centavos. Nada é arredondado.",
      code: { file: F.money, anchor: "static from(props: MoneyProps)", span: 12 },
    },
    { branch: { question: "valor válido?", answer: invalidMoney ? `não → ${exchange.body?.message}` : "sim" }, outcome: invalidMoney ? "fail" : "ok" },
  );
  if (invalidMoney) return finish();

  const hasOpening = Number(input.amount) > 0;
  if (hasOpening) {
    add(
      {
        lane: "domain",
        from: "usecase",
        kind: "domain",
        title: "WagerTransaction.createOpening",
        detail: "A transação interna OPENING já nasce `PROCESSED`, com provedor `internal`. É ela que justifica o primeiro lançamento do ledger.",
        code: { file: F.txAgg, anchor: "static createOpening(", span: 24 },
      },
      { evidence: after.transaction ? "observado" : "inferido", data: after.transaction ?? undefined },
    );
  }
  add(
    {
      lane: "domain",
      from: "domain",
      kind: "domain",
      title: "Wallet.open",
      detail: "Aggregate root: nasce com `version = 1` e, se o saldo inicial for positivo, com o lançamento de CRÉDITO de abertura (o saldo também nasce reconstruível pelo ledger).",
      code: { file: F.walletAgg, anchor: "static open(", span: 22 },
    },
    { note: hasOpening ? `saldo ${money(input.amount, input.currency)} · version 1 · 1 lançamento` : "saldo 0 · version 1 · sem lançamento" },
  );

  add(S.begin(), { from: "usecase", tx: "begin" });
  const duplicate = exchange.status === 409;
  add(
    {
      lane: "db",
      from: "usecase",
      kind: "db",
      title: "INSERT wallets",
      detail: "A unicidade de jogador + moeda é garantida pela constraint `wallets_player_currency_unique` do banco, e não por um \"procura e depois insere\" (que perderia numa corrida).",
      code: { file: F.walletRepo, anchor: "async insert(wallet", span: 4 },
      sql: "INSERT INTO wallets (id, player_id, currency, balance_amount, version, ...) VALUES (...);",
    },
    {
      branch: { question: "já existe carteira deste jogador nesta moeda?", answer: duplicate ? `sim (${before.wallet?.id})` : "não" },
      outcome: duplicate ? "fail" : "ok",
      evidence: "observado",
      data: duplicate ? before.wallet ?? undefined : after.wallet ?? undefined,
    },
  );
  if (duplicate) {
    add(
      {
        lane: "usecase",
        from: "db",
        kind: "error",
        title: "DuplicateKeyError → WALLET_ALREADY_EXISTS",
        detail: "O tradutor de erros do banco transforma a violação de UNIQUE em `DuplicateKeyError`, e o use case a converte em erro de negócio `409`.",
        code: { file: F.createWalletUc, anchor: 'error.constraint === "wallets_player_currency_unique"', span: 3 },
      },
      { outcome: "fail" },
    );
    add(S.rollback, { tx: "rollback" });
    return finish();
  }

  if (hasOpening) {
    const entry = after.ledger[0];
    add(
      {
        ...S.insertLedger,
        detail: `${S.insertLedger.detail} Repare que o lançamento é gravado **antes** da transação OPENING: a FK \`transaction_id\` é \`DEFERRABLE INITIALLY DEFERRED\` e só é conferida no COMMIT.`,
      },
      { note: entry ? `CREDIT ${entry.amount}: 0.00 → ${entry.balanceAfterAmount}` : undefined, evidence: "observado", data: entry },
    );
    add(
      { ...S.insertTransaction, code: { file: F.createWalletUc, anchor: "await this.transactions.insert(opening)" } },
      { note: "OPENING · PROCESSED", evidence: "observado", data: after.transaction ?? undefined },
    );
    add(
      { ...S.buildEvents, from: "usecase", code: { file: F.createWalletUc, anchor: "await this.processor.enqueue([", span: 4 } },
      { note: byEmitOrder(after.outbox).map((row) => row.eventType).join(" + ") },
    );
    for (const row of byEmitOrder(after.outbox)) {
      add({ ...S.insertOutbox, title: `INSERT outbox: ${row.eventType}` }, { evidence: "observado", data: row.payload, note: `eventId ${row.id}` });
    }
  }
  add(S.commit, { tx: "commit", note: invariantNote(after), outcome: "ok" });
  respond(ctx, exchange, F.createWalletCtrl, "const output = await this.createWallet.execute", walletLine(after.wallet));
  ctx.record({ type: "snapshot", title: "Banco depois", before, after });

  if (exchange.status === 201 && walletId) {
    session.upsertWallet({
      id: walletId,
      playerId: exchange.body.playerId,
      currency: exchange.body.balance.currency,
      balance: exchange.body.balance.amount,
    });
  }
  await followOutbox(ctx, after.outbox, options.track);
  return { exchange, after };
};

// ------------------------------------------------------------------ POST /wallets/:walletId/deposits | /withdrawals

interface WalletOperationInput {
  walletId: string;
  operation: "deposits" | "withdrawals";
  amount: string;
  currency: string;
  idempotencyKey: string;
}

/**
 * Deposit or withdrawal (extension, not in the challenge): an internal DEPOSIT/WITHDRAWAL transaction
 * decided by the same processor as the wagers. The client's key is stored scoped to the wallet.
 */
const runWalletOperation = async (ctx: RunContext, input: WalletOperationInput, options: { title?: string; track?: string } = {}) => {
  const { trace } = ctx;
  const add = (def: StepDef, extra: Extra = {}) => trace.add(def, { track: options.track, ...extra });
  const kind = input.operation === "deposits" ? "DEPOSIT" : "WITHDRAWAL";
  const path = `/wallets/${input.walletId}/${input.operation}`;
  const storedKey = `internal:${input.walletId}:${input.idempotencyKey}`;
  const query = { walletId: input.walletId, idempotencyKey: storedKey };

  const before = await api.inspect(query);
  const exchange = await api.http("POST", `/wallets/${encodeURIComponent(input.walletId)}/${input.operation}`, {
    headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {},
    body: { money: { amount: input.amount, currency: input.currency } },
  });
  const after = await api.inspect(query);
  ctx.record({ type: "http", title: options.title ?? `POST /wallets/:walletId/${input.operation}`, exchange, track: options.track });

  const controller = input.operation === "deposits" ? F.depositCtrl : F.withdrawCtrl;
  const finish = () => {
    if ([200, 201, 422].includes(exchange.status)) {
      add({ ...STATUS_FOR, detail: `${STATUS_FOR.detail} O mesmo \`statusFor\` da rota de apostas.` }, {
        note: `${exchange.body?.status}${exchange.body?.idempotentReplay ? " (replay)" : ""} → ${exchange.status}`,
      });
      add(S.httpResponse(exchange.status, controller, "response.status(statusFor(result))"), {
        note: `${exchange.body?.status}${exchange.body?.failureCode ? ` · ${exchange.body.failureCode}` : ""} · saldo ${exchange.body?.balance?.amount ?? "—"}`,
        evidence: "observado",
        data: exchange.body,
        outcome: exchange.status === 422 ? "fail" : "ok",
      });
    } else {
      respond(ctx, exchange, controller, "if (output.isFailure) throw httpErrorFrom(output)");
    }
    return { exchange, after };
  };

  add(S.httpRequest("POST", path, controller, `@Post(":walletId/${input.operation}")`), {
    note: `Idempotency-Key: ${input.idempotencyKey || "(vazio)"} · ${kind} ${money(input.amount, input.currency)}`,
    evidence: "observado",
    data: exchange.request,
  });
  add(S.correlationId, { note: exchange.headers["x-correlation-id"], evidence: "observado" });
  add(S.authGuard, {});
  const dtoError = isDtoError(exchange);
  add(S.validationPipe, {
    branch: { question: "formato do corpo válido?", answer: dtoError ? "não" : "sim" },
    outcome: dtoError ? "fail" : "ok",
  });
  if (dtoError) return finish();

  add(
    {
      lane: "usecase",
      from: "entry",
      kind: "call",
      title: "MoveWalletFundsUseCase",
      detail:
        "Depósito e saque são uma extensão (não estão no enunciado). O use case grava uma transação **interna** (`DEPOSIT` ou `WITHDRAWAL`, provedor `internal`) e a decide com o mesmo processor das apostas: mesma idempotência, mesmo lock, mesmo extrato, mesma outbox.",
      code: { file: F.moveFundsUc, anchor: "async execute(input", span: 8 },
    },
    {},
  );

  const invalid = exchange.status === 400;
  add(
    {
      lane: "domain",
      from: "usecase",
      kind: "decision",
      title: "prepare(): key, id e Money > 0",
      detail: "Validação pura, sem abrir transação: `Idempotency-Key` presente, id de 16 caracteres, dinheiro com 2 casas e **maior que zero**. O `payloadHash` cobre carteira, operação e valor.",
      code: { file: F.moveFundsUc, anchor: "private prepare(input", span: 22 },
    },
    { branch: { question: "entrada válida?", answer: invalid ? `não → ${exchange.body?.code}` : "sim" }, outcome: invalid ? "fail" : "ok" },
  );
  if (invalid) return finish();

  add(S.begin(), { from: "usecase", tx: "begin" });
  const existing = before.transaction;
  add(
    {
      ...S.idempotencyLookup,
      detail:
        "A key do cliente é guardada **com escopo na carteira**: `internal:{walletId}:{key}`. Não colide com as keys dos provedores nem entre carteiras. Já existindo, é reenvio e nem precisa do lock.",
      code: { file: F.moveFundsUc, anchor: "const existing = await this.transactions.findByIdempotencyKey(key)", span: 2 },
    },
    {
      branch: { question: "a key já existe nesta carteira?", answer: existing ? `sim (${existing.kind} ${existing.status})` : "não" },
      note: storedKey,
      evidence: "observado",
      data: existing ?? undefined,
    },
  );

  if (existing) {
    const replay = exchange.status !== 409;
    add(
      { ...S.replayCheck, code: { file: F.moveFundsUc, anchor: "private replay(", span: 4 } },
      {
        branch: { question: "mesmo payloadHash (mesma operação e valor)?", answer: replay ? "sim → replay" : "não → conflito" },
        outcome: replay ? "ok" : "fail",
      },
    );
    add(replay ? S.commit : S.rollback, { tx: replay ? "commit" : "rollback", note: replay ? "nada é movido de novo" : "IDEMPOTENCY_CONFLICT" });
    return finish();
  }

  if (exchange.status === 404) {
    add(S.lockWallet, { branch: { question: "a carteira existe?", answer: "não" }, outcome: "fail", evidence: "observado" });
    add(S.rollback, { tx: "rollback", note: "WALLET_NOT_FOUND" });
    return finish();
  }

  add(S.lockWallet, { lock: "acquire", note: `🔒 ${walletLine(before.wallet)}`, evidence: "observado", data: before.wallet ?? undefined });
  add(
    { ...S.recheckIdempotency, code: { file: F.moveFundsUc, anchor: "const committedMeanwhile", span: 2 } },
    { branch: { question: "alguém gravou enquanto esperávamos o lock?", answer: "não" } },
  );

  const tx = after.transaction;
  if (!tx) {
    add(S.rollback, { tx: "rollback", lock: "release", note: "erro inesperado (veja a resposta)", outcome: "fail" });
    return finish();
  }
  add(
    {
      lane: "domain",
      from: "usecase",
      kind: "domain",
      title: `createWalletOperation(${kind})`,
      detail: `Nasce \`PENDING\`, com provedor \`internal\`, \`externalTransactionId\` = \`${kind.toLowerCase()}:{walletId}:{key}\` e rodada fixa \`wallet-operation\`. Provedores não conseguem criar esse kind: o \`create\` deles recusa e o banco tem uma constraint para isso.`,
      code: { file: F.txAgg, anchor: "static createWalletOperation(", span: 26 },
    },
    { note: `${kind} ${money(tx.amount, tx.currency)} · nasce PENDING`, evidence: "observado", data: tx },
  );

  emitDecision(trace, { track: options.track, origin: "usecase", tx, reference: null, walletAtLock: before.wallet, ledger: after.ledger });
  const newOutbox = after.outbox.filter((row) => !before.outbox.some((old) => old.id === row.id));
  emitPersist(trace, {
    track: options.track,
    origin: "usecase",
    tx,
    walletAtLock: before.wallet,
    ledger: after.ledger,
    outbox: newOutbox,
    after,
    useCaseFile: F.moveFundsUc,
  });
  finish();

  ctx.record({ type: "snapshot", title: "Banco: antes → depois", before, after, track: options.track });
  if (after.wallet) session.updateBalance(input.walletId, after.wallet.balanceAmount as string);
  await followOutbox(ctx, newOutbox, options.track);
  return { exchange, after };
};

// ------------------------------------------------------------------ reads

const runGetWallet = async (ctx: RunContext, walletId: string) => {
  const exchange = await api.http("GET", `/wallets/${encodeURIComponent(walletId)}`);
  ctx.record({ type: "http", title: "GET /wallets/:walletId", exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("GET", `/wallets/${walletId}`, F.getWalletCtrl, '@Get(":walletId")'), { evidence: "observado" });
  trace.add(S.authGuard, {});
  trace.add(
    { lane: "usecase", from: "entry", kind: "call", title: "GetWalletUseCase", detail: "Leitura simples de uma carteira.", code: { file: F.getWalletUc, anchor: "async execute(input", span: 12 } },
    {},
  );
  const invalidId = exchange.status === 400;
  trace.add(idCheck(F.getWalletUc, walletId), {
    branch: { question: "id com 16 caracteres?", answer: invalidId ? "não" : "sim" },
    outcome: invalidId ? "fail" : "ok",
  });
  if (invalidId) return respond(ctx, exchange, F.getWalletCtrl, "const output = await this.getWallet.execute");

  trace.add(readBegin(), { from: "usecase", tx: "begin" });
  const found = exchange.status === 200;
  trace.add(
    {
      lane: "db",
      from: "usecase",
      kind: "db",
      title: "SELECT wallets (sem lock)",
      detail: "Leitura sem `FOR UPDATE`: não bloqueia nem espera as apostas em andamento.",
      code: { file: F.walletRepo, anchor: "async findById(id", span: 4 },
      sql: "SELECT * FROM wallets WHERE id = $1;",
    },
    { branch: { question: "a carteira existe?", answer: found ? "sim" : "não" }, outcome: found ? "ok" : "fail", evidence: "observado" },
  );
  trace.add({ ...S.commit, title: "COMMIT (nada a gravar)" }, { tx: "commit" });
  if (found) {
    trace.add(
      { lane: "usecase", from: "db", kind: "call", title: "WalletViewMapper", detail: "O aggregate vira o formato de resposta: o dinheiro sai como string com 2 casas.", code: { file: F.getWalletUc, anchor: "this.mapper.toRightSide(wallet)" } },
      {},
    );
    session.updateBalance(walletId, exchange.body.balance.amount);
  }
  respond(ctx, exchange, F.getWalletCtrl, "const output = await this.getWallet.execute", found ? `saldo ${exchange.body.balance.amount} · version ${exchange.body.version}` : undefined);
};

const runGetLedger = async (ctx: RunContext, walletId: string, limit: string) => {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  const exchange = await api.http("GET", `/wallets/${encodeURIComponent(walletId)}/ledger${query}`);
  ctx.record({ type: "http", title: "GET /wallets/:walletId/ledger", exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("GET", `/wallets/${walletId}/ledger${query}`, F.ledgerCtrl, '@Get(":walletId/ledger")'), { evidence: "observado" });
  trace.add(S.authGuard, {});
  trace.add(
    { lane: "usecase", from: "entry", kind: "call", title: "GetWalletLedgerUseCase", detail: "Extrato paginado da carteira, do mais novo para o mais antigo.", code: { file: F.ledgerUc, anchor: "async execute(input", span: 16 } },
    {},
  );
  const invalid = exchange.status === 400;
  trace.add(
    {
      lane: "domain",
      from: "usecase",
      kind: "decision",
      title: "valida id, limit (1–200) e cursor",
      detail: "Entradas inválidas respondem `400` sem abrir transação.",
      code: { file: F.ledgerUc, anchor: "if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)", span: 6 },
    },
    { branch: { question: "parâmetros válidos?", answer: invalid ? "não" : "sim" }, outcome: invalid ? "fail" : "ok" },
  );
  if (invalid) return respond(ctx, exchange, F.ledgerCtrl, "const output = await this.getWalletLedger.execute");

  trace.add(readBegin(), { from: "usecase", tx: "begin" });
  const found = exchange.status === 200;
  trace.add(
    { lane: "db", from: "usecase", kind: "db", title: "SELECT wallets", detail: "Confere se a carteira existe (404 se não).", code: { file: F.walletRepo, anchor: "async findById(id" }, sql: "SELECT * FROM wallets WHERE id = $1;" },
    { branch: { question: "a carteira existe?", answer: found ? "sim" : "não" }, outcome: found ? "ok" : "fail", evidence: "observado" },
  );
  if (found) {
    trace.add(
      {
        lane: "db",
        from: "usecase",
        kind: "db",
        title: "SELECT ledger (keyset)",
        detail: "Paginação por chave (`created_at`, `id`), nunca `OFFSET`: continua estável mesmo com lançamentos novos chegando. Busca `limit + 1` para saber se existe próxima página.",
        code: { file: F.ledgerQuery, anchor: 'order by "created_at" desc, "id" desc', span: 2 },
        sql: 'SELECT ... FROM wallet_ledger_entries\n WHERE wallet_id = $1 [AND (created_at, id) < ($2, $3)]\n ORDER BY created_at DESC, id DESC\n LIMIT $limit + 1;',
      },
      { note: `${exchange.body.items.length} lançamento(s)${exchange.body.nextCursor ? " · tem próxima página" : ""}`, evidence: "observado" },
    );
  }
  trace.add({ ...S.commit, title: "COMMIT (nada a gravar)" }, { tx: "commit" });
  if (found) {
    trace.add(
      { lane: "usecase", from: "db", kind: "call", title: "nextCursor", detail: "O cursor codifica o último `(created_at, id)` da página.", code: { file: F.ledgerUc, anchor: "const nextCursor", span: 1 } },
      { note: exchange.body.nextCursor ?? "null (última página)" },
    );
  }
  respond(ctx, exchange, F.ledgerCtrl, "const output = await this.getWalletLedger.execute");
};

const runReconcile = async (ctx: RunContext, walletId: string) => {
  const exchange = await api.http("POST", `/wallets/${encodeURIComponent(walletId)}/reconciliation`);
  ctx.record({ type: "http", title: "POST /wallets/:walletId/reconciliation", exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("POST", `/wallets/${walletId}/reconciliation`, F.reconcileCtrl, '@Post(":walletId/reconciliation")'), { evidence: "observado" });
  trace.add(S.authGuard, {});
  trace.add(
    {
      lane: "usecase",
      from: "entry",
      kind: "call",
      title: "ReconcileWalletUseCase",
      detail: "Reconciliar = conferir dois registros do mesmo dinheiro: o saldo guardado na carteira e o saldo reconstruído somando o ledger.",
      code: { file: F.reconcileUc, anchor: "async execute(input", span: 6 },
    },
    {},
  );
  const invalid = exchange.status === 400;
  trace.add(idCheck(F.reconcileUc, walletId), {
    branch: { question: "id com 16 caracteres?", answer: invalid ? "não" : "sim" },
    outcome: invalid ? "fail" : "ok",
  });
  if (invalid) return respond(ctx, exchange, F.reconcileCtrl, "const output = await this.reconcileWallet.execute");

  trace.add({ ...readBegin("REPEATABLE READ"), code: { file: F.reconcileUc, anchor: '{ isolation: "REPEATABLE READ", readOnly: true }' } }, { from: "usecase", tx: "begin" });
  const found = exchange.status === 200;
  trace.add(
    { lane: "db", from: "usecase", kind: "db", title: "SELECT wallets", detail: "Saldo materializado (o que a carteira diz que tem).", code: { file: F.walletRepo, anchor: "async findById(id" }, sql: "SELECT * FROM wallets WHERE id = $1;" },
    {
      branch: { question: "a carteira existe?", answer: found ? "sim" : "não" },
      outcome: found ? "ok" : "fail",
      evidence: "observado",
      note: found ? `saldo guardado ${exchange.body.storedBalance.amount}` : undefined,
    },
  );
  if (found) {
    trace.add(
      {
        lane: "db",
        from: "usecase",
        kind: "db",
        title: "SELECT sum(ledger)",
        detail: "Reconstrói o saldo a partir do ledger: créditos − débitos. Feito no banco, com `numeric`, sem passar por `float`.",
        code: { file: F.reconcileQuery, anchor: "coalesce(sum(case", span: 6 },
        sql: "SELECT coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)\n  FROM wallet_ledger_entries WHERE wallet_id = $1;",
      },
      { note: `ledger ${exchange.body.calculatedBalance.amount} (${exchange.body.checkedEntries} lançamentos)`, evidence: "observado" },
    );
  }
  trace.add({ ...S.commit, title: "COMMIT (nada a gravar)" }, { tx: "commit" });
  if (found) {
    const ok = exchange.body.consistent;
    trace.add(
      {
        lane: "domain",
        from: "usecase",
        kind: "decision",
        title: "stored − calculated == 0?",
        detail: "Divergência é registrada em log e na métrica `reconciliation_mismatch`, mas **nunca** corrigida automaticamente.",
        code: { file: F.reconcileUc, anchor: "const difference = stored.subtract(calculated)", span: 5 },
      },
      {
        branch: { question: "saldo = ledger?", answer: ok ? "sim → consistent: true" : `não → diferença ${exchange.body.difference.amount}` },
        outcome: ok ? "ok" : "fail",
        evidence: "observado",
      },
    );
  }
  respond(ctx, exchange, F.reconcileCtrl, "const output = await this.reconcileWallet.execute", found ? `consistent: ${exchange.body.consistent}` : undefined);
};

const runGetTransaction = async (ctx: RunContext, transactionId: string) => {
  const exchange = await api.http("GET", `/wagering/transactions/${encodeURIComponent(transactionId)}`);
  ctx.record({ type: "http", title: "GET /wagering/transactions/:transactionId", exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("GET", `/wagering/transactions/${transactionId}`, F.getTxCtrl, '@Get(":transactionId")'), { evidence: "observado" });
  trace.add(S.authGuard, {});
  trace.add(
    { lane: "usecase", from: "entry", kind: "call", title: "GetWagerTransactionUseCase", detail: "Consulta pelo id interno.", code: { file: F.getTxUc, anchor: "async execute(input", span: 12 } },
    {},
  );
  const invalid = exchange.status === 400;
  trace.add(idCheck(F.getTxUc, transactionId), {
    branch: { question: "id com 16 caracteres?", answer: invalid ? "não" : "sim" },
    outcome: invalid ? "fail" : "ok",
  });
  if (invalid) return respond(ctx, exchange, F.getTxCtrl, "const output = await this.getWagerTransaction.execute");
  trace.add(readBegin(), { from: "usecase", tx: "begin" });
  const found = exchange.status === 200;
  trace.add(
    { lane: "db", from: "usecase", kind: "db", title: "SELECT wager_transactions", detail: "Busca pela chave primária.", code: { file: F.txRepo, anchor: "async findById(id", span: 3 }, sql: "SELECT * FROM wager_transactions WHERE id = $1;" },
    { branch: { question: "existe?", answer: found ? `sim (${exchange.body.status})` : "não" }, outcome: found ? "ok" : "fail", evidence: "observado" },
  );
  trace.add({ ...S.commit, title: "COMMIT (nada a gravar)" }, { tx: "commit" });
  respond(ctx, exchange, F.getTxCtrl, "const output = await this.getWagerTransaction.execute", found ? `${exchange.body.kind} · ${exchange.body.status}` : undefined);
};

const runGetProviderTransaction = async (ctx: RunContext, providerId: string, externalTransactionId: string) => {
  const path = `/providers/${encodeURIComponent(providerId)}/wagering/transactions/${encodeURIComponent(externalTransactionId)}`;
  const exchange = await api.http("GET", path);
  ctx.record({ type: "http", title: "GET /providers/:providerId/wagering/transactions/:externalTransactionId", exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("GET", path, F.providerCtrl, '@Get(":providerId/wagering/transactions/:externalTransactionId")'), { evidence: "observado" });
  trace.add(S.authGuard, {});
  trace.add(
    {
      lane: "usecase",
      from: "entry",
      kind: "call",
      title: "GetProviderWagerTransactionUseCase",
      detail: "Consulta pelos ids do provedor: é assim que um provedor confere o que aconteceu com uma transação que ele enviou (por exemplo, depois de um timeout).",
      code: { file: F.providerUc, anchor: "if (!isValid(input.providerId)", span: 10 },
    },
    {},
  );
  trace.add(readBegin(), { from: "usecase", tx: "begin" });
  const found = exchange.status === 200;
  trace.add(
    {
      lane: "db",
      from: "usecase",
      kind: "db",
      title: "SELECT por provider + externalId",
      detail: "Usa o índice da constraint única `wager_tx_provider_external_unique`.",
      code: { file: F.txRepo, anchor: "async findByExternalId", span: 3 },
      sql: "SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2;",
    },
    { branch: { question: "existe?", answer: found ? `sim (${exchange.body.status})` : "não" }, outcome: found ? "ok" : "fail", evidence: "observado" },
  );
  trace.add({ ...S.commit, title: "COMMIT (nada a gravar)" }, { tx: "commit" });
  respond(ctx, exchange, F.providerCtrl, "const output = await this.getProviderWagerTransaction.execute", found ? `${exchange.body.kind} · ${exchange.body.status}` : undefined);
};

const runHealth = async (ctx: RunContext, which: "live" | "ready") => {
  const exchange = await api.http("GET", `/health/${which}`);
  ctx.record({ type: "http", title: `GET /health/${which}`, exchange });
  const { trace } = ctx;

  trace.add(S.httpRequest("GET", `/health/${which}`, F.health, which === "live" ? "live(): HealthLiveDto" : "async ready("), { evidence: "observado" });
  trace.add(
    { ...S.authGuard, detail: "Rotas de health são `@Public()`: sempre abertas, mesmo quando a autenticação existir." },
    {},
  );
  if (which === "live") {
    trace.add(
      { lane: "entry", kind: "return", title: "processo vivo", detail: "Sem I/O de propósito: se o banco cair, o orquestrador não deve reiniciar todas as instâncias.", code: { file: F.health, anchor: "live(): HealthLiveDto", span: 3 } },
      { outcome: "ok" },
    );
  } else {
    const checks = exchange.body?.checks ?? {};
    trace.add(
      { lane: "db", from: "entry", kind: "db", title: "select 1", detail: "Checa o PostgreSQL com timeout de 1s.", code: { file: F.checks, anchor: 'execute("select 1")' }, sql: "select 1;" },
      { note: checks.postgres ? `${checks.postgres.status} · ${checks.postgres.latencyMs ?? "?"} ms` : undefined, evidence: "observado", outcome: checks.postgres?.status === "up" ? "ok" : "fail" },
    );
    trace.add(
      { lane: "sqs", from: "entry", kind: "async", title: "GetQueueAttributes", detail: "Checa se a fila de entrada existe (timeout de 1s).", code: { file: F.checks, anchor: "new GetQueueAttributesCommand({", span: 4 } },
      { note: checks.sqs ? `${checks.sqs.status} · ${checks.sqs.latencyMs ?? "?"} ms` : undefined, evidence: "observado", outcome: checks.sqs?.status === "up" ? "ok" : "fail" },
    );
    trace.add(
      { lane: "entry", from: "sqs", kind: "decision", title: "pronto para tráfego?", detail: "Responde `503` se uma dependência caiu ou se a instância recebeu SIGTERM (para o balanceador parar de mandar requisições).", code: { file: F.health, anchor: "const ok = !shuttingDown", span: 3 } },
      { outcome: exchange.status === 200 ? "ok" : "fail" },
    );
  }
  respond(ctx, exchange, F.health, which === "live" ? "live(): HealthLiveDto" : "response.status(ok ?", exchange.body?.status);
};

export {
  runWalletOperation,
  runCreateWallet,
  runGetLedger,
  runGetProviderTransaction,
  runGetTransaction,
  runGetWallet,
  runHealth,
  runReconcile,
  type CreateWalletInput,
  type WalletOperationInput,
};
