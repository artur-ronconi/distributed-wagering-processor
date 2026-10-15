import { runCreateWallet, runGetLedger, runGetProviderTransaction, runGetTransaction, runGetWallet, runHealth, runReconcile } from "../flows/routes";
import type { RunContext } from "../flows/sink";
import { runSubmitHttp, runSubmitSqs, type SubmitInput } from "../flows/submit";
import { randomId, randomPlayer, session } from "../state";

type FieldKind = "text" | "select" | "wallet" | "transaction" | "reference" | "external";

interface Field {
  name: string;
  label: string;
  kind?: FieldKind;
  options?: string[];
  help?: string;
  /** Initial value, recomputed every time the form opens. */
  initial: () => string;
  /** Shows a "↻" button that calls initial() again. */
  regenerate?: boolean;
  wide?: boolean;
}

type Values = Record<string, string>;

interface Operation {
  id: string;
  group: "wallets" | "transactions" | "queue" | "health";
  method: string;
  path: string;
  title: string;
  description: string;
  fields: Field[];
  /** Keeps dependent fields consistent (e.g. picking a wallet fills playerId and currency). */
  derive?: (values: Values, changed: string) => void;
  preview?: (values: Values) => { method: string; target: string; headers?: Record<string, string>; body?: unknown };
  run(ctx: RunContext, values: Values): Promise<unknown>;
}

const currentWallet = () => session.currentWallet();
const lastTransaction = () => session.get().transactions[0];

const walletField: Field = {
  name: "walletId",
  label: "walletId",
  kind: "wallet",
  initial: () => currentWallet()?.id ?? "",
  help: "16 caracteres. As carteiras criadas aqui aparecem na lista.",
};

const submitFields: Field[] = [
  walletField,
  { name: "playerId", label: "playerId", initial: () => currentWallet()?.playerId ?? "", wide: true },
  { name: "kind", label: "kind", kind: "select", options: ["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"], initial: () => "BET" },
  { name: "amount", label: "amount", initial: () => "25.00", help: "String com exatamente 2 casas." },
  { name: "currency", label: "currency", initial: () => currentWallet()?.currency ?? "BRL" },
  { name: "providerId", label: "providerId", initial: () => "provider-a" },
  { name: "externalTransactionId", label: "externalTransactionId", initial: () => randomId("tx"), regenerate: true },
  {
    name: "idempotencyKey",
    label: "Idempotency-Key (header)",
    initial: () => "",
    help: "Por padrão: providerId:externalTransactionId. Mude para provocar um conflito.",
  },
  { name: "roundId", label: "roundId", initial: () => "round-1" },
  { name: "gameId", label: "gameId", initial: () => "fortune-chimp" },
  {
    name: "referenceExternalTransactionId",
    label: "referenceExternalTransactionId",
    kind: "reference",
    initial: () => "",
    help: "WIN (opcional), REFUND e ROLLBACK. Escolher uma transação da sessão preenche rodada e valor.",
    wide: true,
  },
];

const deriveSubmit = (values: Values, changed: string) => {
  if (changed === "walletId" || changed === "*") {
    const wallet = session.wallet(values.walletId ?? "");
    if (wallet) {
      values.playerId = wallet.playerId;
      values.currency = wallet.currency;
    }
  }
  if (changed === "externalTransactionId" || changed === "providerId" || changed === "*") {
    values.idempotencyKey = `${values.providerId}:${values.externalTransactionId}`;
  }
  if (changed === "referenceExternalTransactionId") {
    const reference = session.get().transactions.find((tx) => tx.externalTransactionId === values.referenceExternalTransactionId);
    if (reference) {
      values.roundId = reference.roundId;
      if (values.kind === "REFUND" || values.kind === "ROLLBACK") values.amount = reference.amount;
    }
  }
  if (changed === "kind" && values.kind === "LOSS") values.amount = "0.00";
};

const toSubmitInput = (values: Values): SubmitInput => ({
  providerId: values.providerId ?? "",
  externalTransactionId: values.externalTransactionId ?? "",
  idempotencyKey: values.idempotencyKey ?? "",
  playerId: values.playerId ?? "",
  walletId: values.walletId ?? "",
  roundId: values.roundId ?? "",
  gameId: values.gameId ?? "",
  kind: values.kind ?? "BET",
  amount: values.amount ?? "",
  currency: values.currency ?? "",
  referenceExternalTransactionId: values.referenceExternalTransactionId || undefined,
});

const submitBody = (values: Values) => {
  const input = toSubmitInput(values);
  return {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: { amount: input.amount, currency: input.currency },
    ...(input.referenceExternalTransactionId ? { referenceExternalTransactionId: input.referenceExternalTransactionId } : {}),
  };
};

const operations: Operation[] = [
  {
    id: "create-wallet",
    group: "wallets",
    method: "POST",
    path: "/wallets",
    title: "Criar carteira",
    description: "Cria a carteira. Saldo inicial positivo gera a transação OPENING, o lançamento de crédito e dois eventos na outbox.",
    fields: [
      { name: "playerId", label: "playerId", initial: randomPlayer, regenerate: true, wide: true },
      { name: "amount", label: "initialBalance.amount", initial: () => "100.00" },
      { name: "currency", label: "initialBalance.currency", kind: "select", options: ["BRL", "USD", "EUR"], initial: () => "BRL" },
    ],
    preview: (v) => ({ method: "POST", target: "/wallets", body: { playerId: v.playerId, initialBalance: { amount: v.amount, currency: v.currency } } }),
    run: (ctx, v) => runCreateWallet(ctx, { playerId: v.playerId ?? "", amount: v.amount ?? "", currency: v.currency ?? "" }),
  },
  {
    id: "get-wallet",
    group: "wallets",
    method: "GET",
    path: "/wallets/:walletId",
    title: "Consultar carteira",
    description: "Leitura simples, sem lock.",
    fields: [walletField],
    preview: (v) => ({ method: "GET", target: `/wallets/${v.walletId}` }),
    run: (ctx, v) => runGetWallet(ctx, v.walletId ?? ""),
  },
  {
    id: "ledger",
    group: "wallets",
    method: "GET",
    path: "/wallets/:walletId/ledger",
    title: "Extrato (ledger)",
    description: "Lançamentos da carteira, do mais novo para o mais antigo, com paginação por cursor.",
    fields: [walletField, { name: "limit", label: "limit", initial: () => "10" }],
    preview: (v) => ({ method: "GET", target: `/wallets/${v.walletId}/ledger?limit=${v.limit}` }),
    run: (ctx, v) => runGetLedger(ctx, v.walletId ?? "", v.limit ?? ""),
  },
  {
    id: "reconcile",
    group: "wallets",
    method: "POST",
    path: "/wallets/:walletId/reconciliation",
    title: "Reconciliar carteira",
    description: "Confere o saldo guardado contra o saldo reconstruído pelo ledger, no mesmo snapshot (REPEATABLE READ).",
    fields: [walletField],
    preview: (v) => ({ method: "POST", target: `/wallets/${v.walletId}/reconciliation` }),
    run: (ctx, v) => runReconcile(ctx, v.walletId ?? ""),
  },
  {
    id: "submit",
    group: "transactions",
    method: "POST",
    path: "/wagering/transactions",
    title: "Enviar transação",
    description: "BET, WIN, LOSS, REFUND ou ROLLBACK. Mostra idempotência, lock da carteira, regras de domínio, ledger, outbox e a publicação assíncrona.",
    fields: submitFields,
    derive: deriveSubmit,
    preview: (v) => ({ method: "POST", target: "/wagering/transactions", headers: { "Idempotency-Key": v.idempotencyKey ?? "" }, body: submitBody(v) }),
    run: (ctx, v) => runSubmitHttp(ctx, toSubmitInput(v)),
  },
  {
    id: "get-transaction",
    group: "transactions",
    method: "GET",
    path: "/wagering/transactions/:transactionId",
    title: "Consultar transação (id interno)",
    description: "Busca pelo id interno de 16 caracteres.",
    fields: [{ name: "transactionId", label: "transactionId", kind: "transaction", initial: () => lastTransaction()?.transactionId ?? "", wide: true }],
    preview: (v) => ({ method: "GET", target: `/wagering/transactions/${v.transactionId}` }),
    run: (ctx, v) => runGetTransaction(ctx, v.transactionId ?? ""),
  },
  {
    id: "get-provider-transaction",
    group: "transactions",
    method: "GET",
    path: "/providers/:providerId/wagering/transactions/:externalTransactionId",
    title: "Consultar transação (ids do provedor)",
    description: "Como o provedor confere o resultado de uma transação que enviou.",
    fields: [
      { name: "providerId", label: "providerId", initial: () => lastTransaction()?.providerId ?? "provider-a" },
      { name: "externalTransactionId", label: "externalTransactionId", kind: "external", initial: () => lastTransaction()?.externalTransactionId ?? "", wide: true },
    ],
    preview: (v) => ({ method: "GET", target: `/providers/${v.providerId}/wagering/transactions/${v.externalTransactionId}` }),
    run: (ctx, v) => runGetProviderTransaction(ctx, v.providerId ?? "", v.externalTransactionId ?? ""),
  },
  {
    id: "sqs-submit",
    group: "queue",
    method: "SQS",
    path: "wager-transactions.fifo",
    title: "Enviar mensagem para a fila",
    description: "A mesma operação, pelo canal assíncrono: consumer SQS, inbox, mesmo use case, ack depois do commit.",
    fields: [{ name: "messageId", label: "messageId (do provedor)", initial: () => randomId("msg"), regenerate: true }, ...submitFields],
    derive: deriveSubmit,
    preview: (v) => ({
      method: "SendMessage",
      target: "wager-transactions.fifo",
      headers: { MessageGroupId: v.walletId ?? "", MessageDeduplicationId: v.messageId ?? "" },
      body: { messageId: v.messageId, type: "WagerTransactionRequested", data: { ...submitBody(v), idempotencyKey: v.idempotencyKey } },
    }),
    run: (ctx, v) => runSubmitSqs(ctx, toSubmitInput(v), { messageId: v.messageId ?? randomId("msg") }),
  },
  {
    id: "health-live",
    group: "health",
    method: "GET",
    path: "/health/live",
    title: "Liveness",
    description: "O processo está vivo? Sem I/O.",
    fields: [],
    preview: () => ({ method: "GET", target: "/health/live" }),
    run: (ctx) => runHealth(ctx, "live"),
  },
  {
    id: "health-ready",
    group: "health",
    method: "GET",
    path: "/health/ready",
    title: "Readiness",
    description: "Pronto para tráfego? Checa PostgreSQL e SQS.",
    fields: [],
    preview: () => ({ method: "GET", target: "/health/ready" }),
    run: (ctx) => runHealth(ctx, "ready"),
  },
];

export { operations, type Field, type Operation, type Values };
