import { api, sleep } from "../api";
import { randomId, randomPlayer } from "../state";
import { followPending } from "./async";
import { S } from "./catalog";
import { runCreateWallet, runWalletOperation } from "./routes";
import { Recorder, type RunContext } from "./sink";
import { collectHttp, emitHttp, followUp, rememberTransaction, runSubmitHttp, runSubmitSqs, type SubmitInput } from "./submit";

interface Scenario {
  id: string;
  title: string;
  summary: string;
  run(ctx: RunContext): Promise<void>;
}

const freshWallet = async (ctx: RunContext, amount: string) => {
  ctx.trace.section(`Preparação: carteira nova com ${amount} BRL`);
  const { exchange } = await runCreateWallet(ctx, { playerId: randomPlayer(), amount, currency: "BRL" }, { title: "Preparação: POST /wallets" });
  if (exchange.status !== 201) throw new Error(`não consegui criar a carteira: HTTP ${exchange.status}`);
  return { walletId: exchange.body.id as string, playerId: exchange.body.playerId as string };
};

const wager = (
  wallet: { walletId: string; playerId: string },
  kind: string,
  amount: string,
  extra: Partial<SubmitInput> = {},
): SubmitInput => {
  const externalTransactionId = extra.externalTransactionId ?? randomId(kind.toLowerCase());
  return {
    providerId: "provider-a",
    externalTransactionId,
    idempotencyKey: `provider-a:${externalTransactionId}`,
    playerId: wallet.playerId,
    walletId: wallet.walletId,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind,
    amount,
    currency: "BRL",
    ...extra,
  };
};

const scenarios: Scenario[] = [
  {
    id: "replay",
    title: "Aposta + reenvio idêntico (replay)",
    summary: "BET 25.00 e o mesmo pedido de novo: o segundo devolve o resultado original (200) sem debitar outra vez.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const bet = wager(wallet, "BET", "25.00");
      ctx.trace.section("1º envio: BET 25.00");
      await runSubmitHttp(ctx, bet);
      ctx.trace.section("2º envio: mesma Idempotency-Key, mesmo payload");
      await runSubmitHttp(ctx, bet, { title: "POST /wagering/transactions (reenvio)" });
    },
  },
  {
    id: "conflict",
    title: "Mesma key, payload diferente (409)",
    summary: "Reusar uma Idempotency-Key com outro valor é conflito, não replay: nada é gravado.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const bet = wager(wallet, "BET", "25.00");
      ctx.trace.section("BET 25.00");
      await runSubmitHttp(ctx, bet);
      ctx.trace.section("mesma key com 30.00");
      await runSubmitHttp(ctx, { ...bet, amount: "30.00" }, { title: "POST /wagering/transactions (payload diferente)" });
    },
  },
  {
    id: "insufficient",
    title: "Saldo insuficiente (422)",
    summary: "BET 25.00 numa carteira com 10.00: a rejeição é gravada e auditável, o saldo não muda.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "10.00");
      ctx.trace.section("BET 25.00 com saldo 10.00");
      await runSubmitHttp(ctx, wager(wallet, "BET", "25.00"));
    },
  },
  {
    id: "win-loss",
    title: "Rodada completa: BET → WIN e BET → LOSS",
    summary: "WIN credita referenciando a aposta; LOSS registra a derrota sem mexer no saldo.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const bet = wager(wallet, "BET", "20.00", { roundId: "round-win" });
      ctx.trace.section("BET 20.00 (round-win)");
      await runSubmitHttp(ctx, bet);
      ctx.trace.section("WIN 50.00 referenciando a BET");
      await runSubmitHttp(ctx, wager(wallet, "WIN", "50.00", { roundId: "round-win", referenceExternalTransactionId: bet.externalTransactionId }));
      const bet2 = wager(wallet, "BET", "10.00", { roundId: "round-loss" });
      ctx.trace.section("BET 10.00 (round-loss)");
      await runSubmitHttp(ctx, bet2);
      ctx.trace.section("LOSS 0.00");
      await runSubmitHttp(ctx, wager(wallet, "LOSS", "0.00", { roundId: "round-loss", referenceExternalTransactionId: undefined }));
    },
  },
  {
    id: "single-reversal",
    title: "Reversão única (REFUND duas vezes)",
    summary: "Uma aposta é revertida no máximo uma vez: o 2º REFUND é rejeitado com REFERENCE_ALREADY_REVERSED.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const bet = wager(wallet, "BET", "25.00");
      ctx.trace.section("BET 25.00");
      await runSubmitHttp(ctx, bet);
      ctx.trace.section("REFUND 25.00");
      await runSubmitHttp(ctx, wager(wallet, "REFUND", "25.00", { referenceExternalTransactionId: bet.externalTransactionId }));
      ctx.trace.section("outro REFUND da mesma aposta");
      await runSubmitHttp(ctx, wager(wallet, "REFUND", "25.00", { referenceExternalTransactionId: bet.externalTransactionId }));
    },
  },
  {
    id: "out-of-order",
    title: "Fora de ordem: ROLLBACK antes da BET",
    summary: "O ROLLBACK chega primeiro (202 PENDING_REFERENCE); o worker tenta de novo com backoff e resolve quando a BET chega.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const betId = randomId("bet");
      ctx.trace.section("ROLLBACK 25.00 de uma BET que ainda não chegou");
      const rollback = await runSubmitHttp(ctx, wager(wallet, "ROLLBACK", "25.00", { referenceExternalTransactionId: betId }), { pendingTimeoutMs: 4_000 });
      ctx.trace.section("a BET chega");
      await runSubmitHttp(ctx, wager(wallet, "BET", "25.00", { externalTransactionId: betId, idempotencyKey: `provider-a:${betId}` }));
      const tx = rollback.after.transaction;
      if (tx) {
        ctx.trace.section("o worker de pendências resolve o ROLLBACK", "");
        await followPending(ctx, tx.id as string, {
          timeoutMs: 15_000,
          knownOutboxIds: new Set(rollback.after.outbox.map((row) => row.id as string)),
        });
      }
    },
  },
  {
    id: "cashier",
    title: "Caixa: depósito, saque e saque sem saldo",
    summary: "Depósito e saque (extensão) passam pelo mesmo lock, extrato e outbox das apostas. O saque acima do saldo é rejeitado e gravado; o reenvio é replay.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const op = (operation: "deposits" | "withdrawals", amount: string, idempotencyKey = randomId("cashier")) =>
        runWalletOperation(ctx, { walletId: wallet.walletId, operation, amount, currency: "BRL", idempotencyKey });
      ctx.trace.section("depósito de 50.00");
      await op("deposits", "50.00");
      ctx.trace.section("saque de 30.00");
      await op("withdrawals", "30.00");
      const key = randomId("cashier");
      ctx.trace.section("saque de 500.00 (saldo 120.00)");
      await op("withdrawals", "500.00", key);
      ctx.trace.section("o mesmo saque, de novo");
      await op("withdrawals", "500.00", key);
    },
  },
  {
    id: "race",
    title: "Concorrência: 2× BET 80.00 com saldo 100.00",
    summary: "Duas apostas simultâneas na mesma carteira: o FOR UPDATE enfileira; uma passa (201) e a outra vê o saldo já debitado (422).",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const a = wager(wallet, "BET", "80.00");
      const b = wager(wallet, "BET", "80.00");
      ctx.trace.section("as duas requisições saem ao mesmo tempo");
      const [first, second] = await Promise.all([collectHttp(a, "A"), collectHttp(b, "B")]);

      // Who got the lock first: the one decided earlier (processed_at from the database).
      const at = (ev: typeof first) => new Date(String(ev.after.transaction?.processedAt ?? 0)).getTime();
      const [winner, loser] = at(first) <= at(second) ? [first, second] : [second, first];
      winner.track = "A";
      loser.track = "B";
      const winnerEntry = winner.after.ledger[0];
      loser.walletAtLock = winnerEntry
        ? { ...winner.before.wallet, balanceAmount: winnerEntry.balanceAfterAmount, version: Number(winner.before.wallet?.version) + 1 }
        : winner.before.wallet;

      const ra = new Recorder();
      const rb = new Recorder();
      emitHttp(ra, winner);
      emitHttp(rb, loser);
      const lockA = ra.indexOf((entry) => entry.def.title === S.lockWallet.title);
      const lockB = rb.indexOf((entry) => entry.def.title === S.lockWallet.title);

      if (lockA < 0 || lockB < 0) {
        ra.replay(ctx.trace);
        rb.replay(ctx.trace);
      } else {
        ra.replay(ctx.trace, 0, lockA + 1);
        rb.replay(ctx.trace, 0, lockB);
        ctx.trace.add(S.lockWallet, {
          track: "B",
          lock: "wait",
          note: "B pede o mesmo lock e fica esperando A terminar",
          evidence: "inferido",
        });
        // A commits (releasing the lock) and answers; only then B gets the lock.
        ra.replay(ctx.trace, lockA + 1);
        rb.replay(ctx.trace, lockB);
      }

      for (const ev of [winner, loser]) {
        ctx.record({ type: "http", title: `Requisição ${ev.track}: ${ev.exchange.status}`, exchange: ev.exchange, track: ev.track });
        rememberTransaction(ev.input, ev.after);
      }
      const finalState = await api.inspect({ walletId: wallet.walletId });
      ctx.record({ type: "snapshot", title: "Banco depois das duas", before: winner.before, after: finalState });
      ctx.record({
        type: "note",
        title: "Como a ordem foi reconstruída",
        text: `A ordem vem do processed_at gravado de cada transação (A: ${winner.after.transaction?.processedAt}, B: ${loser.after.transaction?.processedAt}). A espera de B pelo lock é inferida: a resposta de B levou ${loser.exchange.durationMs} ms e a de A ${winner.exchange.durationMs} ms.`,
        tone: "ok",
      });
      await Promise.all([followUp(ctx, winner, 0), followUp(ctx, loser, 0)]);
    },
  },
  {
    id: "sqs-ok",
    title: "SQS: BET pela fila",
    summary: "A mesma aposta, agora pela fila: inbox na mesma transação e ack só depois do commit.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      ctx.trace.section("BET 25.00 via wager-transactions.fifo");
      await runSubmitSqs(ctx, wager(wallet, "BET", "25.00"), { messageId: randomId("msg") });
    },
  },
  {
    id: "sqs-duplicate",
    title: "SQS: mensagem entregue duas vezes (inbox)",
    summary: "A mesma mensagem chega de novo (republicação com outro dedup id, então o broker não filtra): a inbox absorve.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const input = wager(wallet, "BET", "25.00");
      const messageId = randomId("msg");
      ctx.trace.section("1ª entrega");
      await runSubmitSqs(ctx, input, { messageId, deduplicationId: `${messageId}-a` });
      await sleep(300);
      ctx.trace.section("2ª entrega da mesma mensagem");
      await runSubmitSqs(ctx, input, { messageId, deduplicationId: `${messageId}-b`, title: "Mesma mensagem, de novo" });
    },
  },
  {
    id: "sqs-cross-channel",
    title: "Mesma operação por HTTP e por SQS",
    summary: "A Idempotency-Key vale entre canais: o pedido que chega depois pela fila vira replay.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const input = wager(wallet, "BET", "25.00");
      ctx.trace.section("pela API HTTP");
      await runSubmitHttp(ctx, input);
      ctx.trace.section("a mesma operação pela fila");
      await runSubmitSqs(ctx, input, { messageId: randomId("msg") });
    },
  },
  {
    id: "sqs-dlq",
    title: "SQS: mensagem malformada → DLQ",
    summary: "Um corpo que não é um envelope válido nunca vai dar certo: vai para a DLQ com o motivo, sem gravar nada.",
    async run(ctx) {
      const wallet = await freshWallet(ctx, "100.00");
      const before = await api.depth();
      ctx.trace.section("envia um corpo inválido");
      await runSubmitSqs(ctx, wager(wallet, "BET", "25.00"), {
        messageId: randomId("bad"),
        rawBody: '{"type":"Unknown","oops":true}',
        title: "Mensagem malformada",
      });
      const after = await api.depth();
      const dlqBefore = before.find((queue) => queue.queue.includes("dlq"));
      const dlqAfter = after.find((queue) => queue.queue.includes("dlq"));
      ctx.record({
        type: "note",
        title: "Profundidade da DLQ",
        text: `wager-transactions-dlq.fifo: ${dlqBefore?.visible ?? "?"} → ${dlqAfter?.visible ?? "?"} mensagem(ns) visível(is).`,
        tone: "ok",
      });
    },
  },
];

export { scenarios, type Scenario };
