import { bet, coinFlip, loss, refund, rollback, win, type Outcome } from "../actions";
import { display, multiply, normalize } from "../money";
import { store, type ConsoleWallet, type Round } from "../store";
import { explanationCard, roundBadge } from "./badges";
import { busy, h, replace, time } from "./dom";

const CHIPS = ["5", "10", "25", "50", "100"];

const amountInput = (initial: string) => {
  const input = h("input", { class: "amount-input", value: initial, inputmode: "decimal" });
  const chips = h(
    "div",
    { class: "chips-row" },
    ...CHIPS.map((value) => h("button", { type: "button", class: "chip-btn", onclick: () => (input.value = `${value}.00`) }, value)),
  );
  return { input, chips };
};

/** Last result of this tab, explained. */
const outcomeBox = () => {
  const box = h("div", { class: "outcome" });
  return {
    box,
    show(outcome: Outcome | null, prefix?: string) {
      if (!outcome) return;
      replace(box, explanationCard(outcome.explanation, prefix ? h("p", { class: "muted" }, prefix) : null));
    },
    error(text: string) {
      replace(box, explanationCard({ tone: "fail", title: "Valor inválido", text }));
    },
  };
};

class PlayTab {
  readonly element = h("div", { class: "tab-play" });
  private readonly openRounds = h("div", { class: "rounds" });
  private readonly closedRounds = h("div", { class: "rounds closed" });
  private readonly result = outcomeBox();
  private readonly coin = h("div", { class: "coin" }, h("span", {}, "?"));

  constructor(private readonly wallet: ConsoleWallet) {
    this.element.append(
      this.result.box,
      h("div", { class: "games" }, this.tableCard(), this.coinCard()),
      h("h3", { class: "section-title" }, "Rodadas em aberto"),
      h("p", { class: "muted small" }, "A aposta já saiu do saldo. Agora diga o que aconteceu na rodada."),
      this.openRounds,
      h("h3", { class: "section-title" }, "Rodadas encerradas"),
      this.closedRounds,
    );
    this.refresh();
  }

  private tableCard() {
    const { input, chips } = amountInput("25.00");
    const button = h("button", { class: "btn primary block" }, "Apostar");
    button.addEventListener("click", () => {
      const amount = normalize(input.value);
      if (!amount) return this.result.error("Use um valor como 25 ou 25.50 (até 2 casas).");
      void busy(button, async () => this.result.show(await bet(this.current(), amount)));
    });
    return h(
      "div",
      { class: "card game" },
      h("div", { class: "game-head" }, h("span", { class: "game-icon" }, "🎰"), h("div", {}, h("h3", {}, "Mesa livre"), h("small", {}, "Você aposta e depois decide o resultado"))),
      h("label", {}, h("span", {}, `Valor (${this.wallet.currency})`), input),
      chips,
      button,
    );
  }

  private coinCard() {
    const { input, chips } = amountInput("10.00");
    let pick: "cara" | "coroa" = "cara";
    const pickButtons = (["cara", "coroa"] as const).map((side) =>
      h("button", { type: "button", class: `pick${side === pick ? " active" : ""}`, "data-side": side }, side === "cara" ? "Cara" : "Coroa"),
    );
    pickButtons.forEach((button) =>
      button.addEventListener("click", () => {
        pick = button.dataset.side as "cara" | "coroa";
        pickButtons.forEach((other) => other.classList.toggle("active", other === button));
      }),
    );

    const button = h("button", { class: "btn primary block" }, "Jogar a moeda");
    button.addEventListener("click", () => {
      const amount = normalize(input.value);
      if (!amount) return this.result.error("Use um valor como 10 ou 10.50 (até 2 casas).");
      void busy(button, async () => {
        this.coin.className = "coin spinning";
        const [game] = await Promise.all([coinFlip(this.current(), amount, pick), new Promise((resolve) => setTimeout(resolve, 900))]);
        if (!game.outcome) {
          this.coin.className = "coin";
          replace(this.coin, h("span", {}, "?"));
          return this.result.show(game.placed, "A aposta não passou, então a moeda nem foi jogada.");
        }
        const won = game.outcome === pick;
        this.coin.className = `coin ${won ? "won" : "lost"}`;
        replace(this.coin, h("span", {}, game.outcome === "cara" ? "C" : "K"));
        this.result.show(
          game.settled,
          `Deu ${game.outcome}. ${won ? `Você ganhou ${display(multiply(amount, 2n))} (aposta × 2): foram duas transações, BET e WIN.` : "Você perdeu: foram duas transações, BET (debitou) e LOSS (só registra, não mexe no saldo)."}`,
        );
      });
    });

    return h(
      "div",
      { class: "card game" },
      h("div", { class: "game-head" }, h("span", { class: "game-icon" }, "🪙"), h("div", {}, h("h3", {}, "Cara ou coroa"), h("small", {}, "Acertou: recebe 2×. Errou: perde a aposta"))),
      h("div", { class: "coin-row" }, this.coin, h("div", { class: "picks" }, ...pickButtons)),
      h("label", {}, h("span", {}, `Valor (${this.wallet.currency})`), input),
      chips,
      button,
    );
  }

  private current() {
    return store.wallet(this.wallet.id) ?? this.wallet;
  }

  refresh() {
    const rounds = store.roundsOf(this.wallet.id);
    const open = rounds.filter((round) => round.state === "open");
    const closed = rounds.filter((round) => round.state !== "open").slice(0, 12);
    replace(this.openRounds, open.length === 0 ? h("p", { class: "empty" }, "Nenhuma rodada em aberto. Faça uma aposta na mesa livre.") : null, ...open.map((round) => this.openRound(round)));
    replace(this.closedRounds, closed.length === 0 ? h("p", { class: "empty" }, "Nada por aqui ainda.") : null, ...closed.map((round) => this.closedRound(round)));
  }

  private openRound(round: Round) {
    const prize = h("input", { class: "amount-input small", value: multiply(round.amount, 2n), inputmode: "decimal", title: "valor do prêmio" });
    const act = (label: string, cls: string, run: () => Promise<Outcome>, hint: string) => {
      const button = h("button", { class: `btn ${cls}`, title: hint }, label);
      button.addEventListener(
        "click",
        () =>
          void busy(button, async () => {
            try {
              this.result.show(await run());
            } catch (error) {
              this.result.error((error as Error).message);
            }
          }),
      );
      return button;
    };
    const betTx = store.transaction(round.betExternalTransactionId);

    return h(
      "div",
      { class: "round card" },
      h(
        "div",
        { class: "round-info" },
        h("strong", {}, `${round.game === "moeda" ? "🪙" : "🎰"} ${display(round.amount, round.currency)}`),
        h("code", {}, round.roundId),
        h("small", { class: "muted" }, time(round.createdAt)),
      ),
      h(
        "div",
        { class: "round-actions" },
        h("span", { class: "prize" }, "Prêmio", prize),
        act(
          "Ganhou",
          "ok",
          async () => {
            const amount = normalize(prize.value);
            if (!amount) throw new Error("Prêmio inválido: use um valor como 50 ou 50.25 (até 2 casas).");
            return win(round, amount);
          },
          "WIN: credita o prêmio, apontando para a aposta desta rodada",
        ),
        act("Perdeu", "fail", () => loss(round), "LOSS: registra a derrota, sem mexer no saldo"),
        act("Reembolsar", "ghost", () => refund(round), "REFUND: devolve a aposta inteira (rodada cancelada)"),
        betTx ? act("Estornar aposta", "ghost", () => rollback(betTx), "ROLLBACK: desfaz a aposta (credita de volta)") : null,
      ),
    );
  }

  private closedRound(round: Round) {
    return h(
      "div",
      { class: "round closed-round" },
      h("span", {}, round.game === "moeda" ? "🪙" : "🎰"),
      h("span", { class: "amount neutral" }, display(round.amount, round.currency)),
      round.pick ? h("small", { class: "muted" }, `apostou ${round.pick}${round.outcome ? `, deu ${round.outcome}` : ""}`) : null,
      roundBadge(round.state),
      h("code", { class: "muted" }, round.roundId),
    );
  }
}

export { PlayTab };
