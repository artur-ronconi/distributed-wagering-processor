import { activity } from "../activity";
import { api } from "../api";
import { moveFunds, refreshWallet } from "../actions";
import { display, normalize } from "../money";
import { store, type ConsoleWallet } from "../store";
import { explanationCard } from "./badges";
import { busy, h, replace } from "./dom";

const copyable = (label: string, value: string) =>
  h(
    "button",
    { class: "chip", title: "copiar", onclick: () => void navigator.clipboard?.writeText(value) },
    h("span", { class: "chip-label" }, label),
    h("code", {}, value),
  );

/** Balance, ids and the "does the balance match the statement?" check. */
class WalletHeader {
  readonly element = h("section", { class: "wallet-header card" });
  private readonly balance = h("div", { class: "balance" });
  private readonly version = h("span", { class: "version" });
  private readonly check = h("div", { class: "check-result" });
  private readonly cashierResult = h("div", { class: "check-result" });

  constructor(private readonly wallet: ConsoleWallet) {
    const refresh = h("button", { class: "btn ghost" }, "↻ Atualizar");
    refresh.addEventListener("click", () => void busy(refresh, () => refreshWallet(wallet.id)));

    const reconcile = h("button", { class: "btn ghost" }, "✓ Conferir saldo × extrato");
    reconcile.addEventListener("click", () => void busy(reconcile, () => this.reconcile()));

    this.element.append(
      h(
        "div",
        { class: "wallet-top" },
        h("div", {}, h("h1", {}, wallet.nickname), h("div", { class: "chips" }, copyable("carteira", wallet.id), copyable("jogador", wallet.playerId))),
        h("div", { class: "balance-box" }, h("small", {}, "Saldo"), this.balance, this.version),
      ),
      h("div", { class: "wallet-actions" }, refresh, reconcile),
      this.check,
      this.cashier(),
      this.cashierResult,
    );
    this.refresh();
  }

  private checkedVersion: number | null = null;

  /** Deposit and withdrawal: POST /wallets/:walletId/deposits and /withdrawals. */
  private cashier() {
    const amount = h("input", { class: "amount-input small", value: "50.00", inputmode: "decimal", title: "valor" });
    const run = (operation: "DEPOSIT" | "WITHDRAWAL") => {
      const button = h("button", { class: `btn ${operation === "DEPOSIT" ? "ok" : "fail"}` }, operation === "DEPOSIT" ? "＋ Depositar" : "－ Sacar");
      button.addEventListener("click", () => {
        const value = normalize(amount.value);
        if (!value) {
          replace(this.cashierResult, explanationCard({ tone: "fail", title: "Valor inválido", text: "Use um valor como 50 ou 50.25 (até 2 casas)." }));
          return;
        }
        void busy(button, async () => {
          const outcome = await moveFunds(store.wallet(this.wallet.id) ?? this.wallet, operation, value);
          replace(this.cashierResult, explanationCard(outcome.explanation));
        });
      });
      return button;
    };
    return h(
      "div",
      { class: "cashier" },
      h("span", { class: "cashier-label", title: "operações de caixa, fora de uma rodada" }, "Caixa"),
      amount,
      run("DEPOSIT"),
      run("WITHDRAWAL"),
      h("small", { class: "muted" }, "Saque acima do saldo é recusado (422) e fica registrado."),
    );
  }

  refresh() {
    const wallet = store.wallet(this.wallet.id);
    if (!wallet) return;
    // A check answers for one moment: once the balance moves, it is no longer about the current state.
    if (this.checkedVersion !== null && this.checkedVersion !== wallet.version) {
      replace(this.check);
      this.checkedVersion = null;
    }
    const [whole, cents] = display(wallet.balance).split(",");
    replace(this.balance, h("span", { class: "big" }, whole), h("span", { class: "cents" }, `,${cents}`), h("span", { class: "currency" }, wallet.currency));
    this.version.textContent = `versão ${wallet.version}`;
  }

  private async reconcile() {
    const call = await api.reconcile(this.wallet.id);
    if (!call.ok || !call.data) {
      const explanation = { tone: "fail" as const, title: `${call.error?.code} (${call.status})`, text: call.error?.message ?? "" };
      activity.add("Conferência saldo × extrato", call, explanation);
      replace(this.check, explanationCard(explanation));
      return;
    }
    const r = call.data;
    this.checkedVersion = store.wallet(this.wallet.id)?.version ?? null;
    const explanation = r.consistent
      ? {
          tone: "ok" as const,
          title: "Saldo confere com o extrato ✓",
          text: `O saldo guardado (${r.storedBalance.amount}) é igual à soma dos ${r.checkedEntries} lançamentos do extrato (${r.calculatedBalance.amount}). As duas leituras foram feitas no mesmo instante do banco.`,
        }
      : {
          tone: "fail" as const,
          title: "Divergência!",
          text: `Saldo ${r.storedBalance.amount} × extrato ${r.calculatedBalance.amount} (diferença ${r.difference.amount}). O backend registra e alerta, mas nunca corrige sozinho.`,
        };
    activity.add("Conferência saldo × extrato", call, explanation);
    replace(this.check, explanationCard(explanation));
  }
}

export { WalletHeader };
