import { buildInput, GAME, newRoundId, rollback, send, type Outcome } from "../actions";
import type { Kind } from "../api";
import { fromCents, toCents } from "../money";
import { KIND_LABEL } from "../rules";
import { store, type ConsoleWallet } from "../store";
import { explanationCard } from "./badges";
import { busy, h, replace, rich } from "./dom";

interface Experiment {
  title: string;
  rule: string;
  expect: string;
  run: () => Promise<Outcome[]>;
}

/**
 * Shortcuts that provoke each business rule on purpose, plus a free form for anything else.
 * Everything goes through the same public API as the game.
 */
class LabTab {
  readonly element = h("div", { class: "tab-lab" });
  private readonly result = h("div", { class: "lab-result" });
  private pendingBetId: string | null = null;
  private pendingRoundId: string | null = null;

  constructor(private readonly wallet: ConsoleWallet) {
    this.element.append(
      h("p", { class: "muted small" }, "Cada experimento provoca uma regra de negócio de propósito. O resultado aparece abaixo e no painel de atividade."),
      h("div", { class: "experiments" }, ...this.experiments().map((experiment) => this.card(experiment))),
      this.result,
      h("h3", { class: "section-title" }, "Envio livre"),
      this.freeForm(),
    );
  }

  private current() {
    return store.wallet(this.wallet.id) ?? this.wallet;
  }

  private async placeBet(amount: string) {
    const wallet = this.current();
    return send(buildInput(wallet, "BET", amount, newRoundId(), GAME.mesa), `Aposta de ${amount} ${wallet.currency}`);
  }

  private experiments(): Experiment[] {
    return [
      {
        title: "Reenviar o mesmo pedido",
        rule: "Idempotência",
        expect: "1º → 201, 2º → 200 com o resultado original. O saldo cai uma vez só.",
        run: async () => {
          const first = await this.placeBet("1.00");
          const again = first.tx ? await send(first.tx.payload, "Reenvio (mesma key, mesmo conteúdo)") : first;
          return [first, again];
        },
      },
      {
        title: "Mesma key, outro valor",
        rule: "Idempotência",
        expect: "409 IDEMPOTENCY_CONFLICT: a key já pertence a outro pedido. Nada é gravado.",
        run: async () => {
          const first = await this.placeBet("1.00");
          if (!first.tx) return [first];
          const changed = { ...first.tx.payload, money: { ...first.tx.payload.money, amount: "2.00" } };
          return [first, await send(changed, "Mesma Idempotency-Key com valor 2.00")];
        },
      },
      {
        title: "Mesmo id externo, outra key",
        rule: "Identidade da transação",
        expect: "409: o mesmo externalTransactionId não pode chegar com duas keys diferentes.",
        run: async () => {
          const first = await this.placeBet("1.00");
          if (!first.tx) return [first];
          const otherKey = { ...first.tx.payload, idempotencyKey: `${first.tx.payload.idempotencyKey}-outra` };
          return [first, await send(otherKey, "Mesmo externalTransactionId, outra key")];
        },
      },
      {
        title: "Apostar mais do que o saldo",
        rule: "Saldo nunca negativo",
        expect: "422 INSUFFICIENT_FUNDS. A tentativa fica registrada como rejeitada, o saldo não muda.",
        run: async () => [await this.placeBet(fromCents(toCents(this.current().balance) + 100n))],
      },
      {
        title: "Valor com 3 casas decimais",
        rule: "Dinheiro exato",
        expect: "400: dinheiro tem exatamente 2 casas. Nada é arredondado.",
        run: async () => [await this.placeBet("1.234")],
      },
      {
        title: "Reembolsar a mesma aposta duas vezes",
        rule: "Reversão única",
        expect: "1º REFUND → 201, 2º → 422 REFERENCE_ALREADY_REVERSED.",
        run: async () => {
          const placed = await this.placeBet("1.00");
          if (placed.tx?.status !== "PROCESSED") return [placed];
          const wallet = this.current();
          const refund = () =>
            send(
              buildInput(wallet, "REFUND", "1.00", placed.tx!.roundId, GAME.mesa, placed.tx!.externalTransactionId),
              "Reembolso da aposta",
            );
          return [placed, await refund(), await refund()];
        },
      },
      {
        title: "Duas apostas ao mesmo tempo",
        rule: "Concorrência",
        expect: "Cada uma de 60% do saldo, em paralelo: uma passa (201), a outra vê o saldo já debitado (422). Nunca as duas.",
        run: async () => {
          const sixty = fromCents((toCents(this.current().balance) * 60n) / 100n);
          if (toCents(sixty) <= 0n) throw new Error("A carteira precisa de saldo para este experimento.");
          return Promise.all([this.placeBet(sixty), this.placeBet(sixty)]);
        },
      },
      {
        title: "Estorno antes da aposta (parte 1)",
        rule: "Mensagens fora de ordem",
        expect: "202 PENDING_REFERENCE: o estorno espera a aposta chegar. Depois rode a parte 2.",
        run: async () => {
          const wallet = this.current();
          this.pendingBetId = `bet-${Math.random().toString(36).slice(2, 10)}`;
          this.pendingRoundId = newRoundId();
          const input = buildInput(wallet, "ROLLBACK", "1.00", this.pendingRoundId, GAME.mesa, this.pendingBetId);
          return [await send(input, `Estorno da aposta ${this.pendingBetId}, que ainda não existe`)];
        },
      },
      {
        title: "Agora a aposta chega (parte 2)",
        rule: "Mensagens fora de ordem",
        expect: "201 para a aposta. Em poucos segundos o worker do backend aplica o estorno sozinho (acompanhe em Transações).",
        run: async () => {
          if (!this.pendingBetId || !this.pendingRoundId) throw new Error("Rode a parte 1 antes.");
          const wallet = this.current();
          const input = { ...buildInput(wallet, "BET", "1.00", this.pendingRoundId, GAME.mesa), externalTransactionId: this.pendingBetId, idempotencyKey: `wallet-console:${this.pendingBetId}` };
          this.pendingBetId = null;
          return [await send(input, "A aposta referenciada chega")];
        },
      },
      {
        title: "Estornar uma vitória com saldo gasto",
        rule: "Estorno sem saldo",
        expect: "Aposta 1.00, vitória de todo o saldo + 1.00, gasta tudo numa aposta e estorna a vitória: 422 REVERSAL_WOULD_OVERDRAW.",
        run: async () => {
          const wallet = this.current();
          const roundId = newRoundId();
          const placed = await send(buildInput(wallet, "BET", "1.00", roundId, GAME.mesa), "Aposta de 1.00");
          if (placed.tx?.status !== "PROCESSED") return [placed];
          const prize = fromCents(toCents(this.current().balance) + 100n);
          const won = await send(buildInput(wallet, "WIN", prize, roundId, GAME.mesa, placed.tx.externalTransactionId), `Vitória de ${prize}`);
          const all = this.current().balance;
          const spent = await send(buildInput(wallet, "BET", all, newRoundId(), GAME.mesa), `Aposta de todo o saldo (${all})`);
          const reversal = won.tx ? await rollback(won.tx) : won;
          return [placed, won, spent, reversal];
        },
      },
    ];
  }

  private card(experiment: Experiment) {
    const button = h("button", { class: "btn primary" }, "Rodar");
    button.addEventListener(
      "click",
      () =>
        void busy(button, async () => {
          try {
            const outcomes = await experiment.run();
            replace(
              this.result,
              h("h4", {}, experiment.title),
              ...outcomes.map((outcome, index) => explanationCard(outcome.explanation, h("small", { class: "muted" }, `passo ${index + 1}`))),
            );
          } catch (error) {
            replace(this.result, explanationCard({ tone: "fail", title: experiment.title, text: (error as Error).message }));
          }
        }),
    );
    return h(
      "div",
      { class: "card experiment" },
      h("span", { class: "rule-tag" }, experiment.rule),
      h("h4", {}, experiment.title),
      h("p", { class: "muted small" }, rich(experiment.expect)),
      button,
    );
  }

  private freeForm() {
    const wallet = this.current();
    const kind = h("select", {}, ...(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"] as const).map((value) => h("option", { value }, `${value} · ${KIND_LABEL[value]}`)));
    const amount = h("input", { value: "1.00", title: "enviado como está: teste 1.5 ou 1.234" });
    const round = h("input", { value: newRoundId() });
    const external = h("input", { value: `free-${Math.random().toString(36).slice(2, 8)}` });
    const key = h("input", { value: "" });
    const reference = h("input", { placeholder: "externalTransactionId de outra transação", list: "my-external-ids" });
    const ids = h("datalist", { id: "my-external-ids" });
    const syncKey = () => (key.value = `wallet-console:${external.value}`);
    syncKey();
    external.addEventListener("input", syncKey);
    reference.addEventListener("focus", () =>
      replace(ids, ...store.transactionsOf(wallet.id).map((tx) => h("option", { value: tx.externalTransactionId }, `${tx.kind} ${tx.amount} · ${tx.status} · ${tx.roundId}`))),
    );
    reference.addEventListener("change", () => {
      const target = store.transaction(reference.value);
      if (target) round.value = target.roundId;
    });

    const submit = h("button", { class: "btn primary" }, "Enviar");
    submit.addEventListener(
      "click",
      () =>
        void busy(submit, async () => {
          const current = this.current();
          const input = {
            ...buildInput(current, kind.value as Kind, amount.value.trim(), round.value.trim(), GAME.mesa, reference.value.trim() || undefined),
            externalTransactionId: external.value.trim(),
            idempotencyKey: key.value.trim(),
          };
          const outcome = await send(input, `Envio livre: ${kind.value} ${amount.value}`);
          replace(this.result, h("h4", {}, "Envio livre"), explanationCard(outcome.explanation));
          external.value = `free-${Math.random().toString(36).slice(2, 8)}`;
          syncKey();
        }),
    );

    const field = (label: string, input: HTMLElement) => h("label", {}, h("span", {}, label), input);
    return h(
      "div",
      { class: "card free-form" },
      h(
        "div",
        { class: "free-grid" },
        field("kind", kind),
        field("amount (sem normalizar)", amount),
        field("roundId", round),
        field("externalTransactionId", external),
        field("Idempotency-Key", key),
        field("referenceExternalTransactionId", reference),
      ),
      ids,
      submit,
    );
  }
}

export { LabTab };
