import { activity } from "../activity";
import { api, type LedgerEntry } from "../api";
import { display } from "../money";
import { store, type ConsoleWallet } from "../store";
import { kindBadge } from "./badges";
import { busy, h, replace } from "./dom";

/** The wallet statement as the backend keeps it: only what moved the balance, newest first. */
class LedgerTab {
  readonly element = h("div", { class: "tab-ledger" });
  private readonly body = h("tbody");
  private readonly footer = h("div", { class: "ledger-footer" });
  private entries: LedgerEntry[] = [];
  private cursor: string | null = null;

  constructor(private readonly wallet: ConsoleWallet) {
    this.element.append(
      h(
        "p",
        { class: "muted small" },
        "O extrato (ledger) vem do backend e é ",
        h("strong", {}, "só de inclusão"),
        ": nenhum lançamento é alterado ou apagado, nem pelo próprio banco. Cada linha mostra o saldo antes e depois, e as contas sempre fecham. Rejeições e derrotas não aparecem aqui porque não mexeram no saldo.",
      ),
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ...["Quando", "Origem", "Movimento", "Saldo antes", "Saldo depois"].map((title) => h("th", {}, title)))),
        this.body,
      ),
      this.footer,
    );
  }

  /** Reloads from the first page (called when the tab opens and after every change). */
  async reload() {
    this.entries = [];
    this.cursor = null;
    await this.loadPage();
  }

  private async loadPage() {
    const call = await api.ledger(this.wallet.id, this.cursor ?? undefined);
    if (!call.ok || !call.data) {
      activity.add("Extrato", call, { tone: "fail", title: `${call.error?.code} (${call.status})`, text: call.error?.message ?? "" });
      replace(this.footer, h("p", { class: "error" }, "Não foi possível carregar o extrato."));
      return;
    }
    this.entries.push(...call.data.items);
    this.cursor = call.data.nextCursor;
    this.render();
  }

  private render() {
    const byInternalId = new Map(store.transactionsOf(this.wallet.id).map((tx) => [tx.transactionId, tx]));
    replace(
      this.body,
      ...this.entries.map((entry) => {
        const tx = byInternalId.get(entry.transactionId);
        const credit = entry.direction === "CREDIT";
        return h(
          "tr",
          {},
          h("td", { class: "muted" }, new Date(entry.createdAt).toLocaleString("pt-BR")),
          h("td", {}, tx ? kindBadge(tx.kind) : h("span", { class: "kind kind-opening", title: "transação interna criada junto com a carteira" }, "Abertura")),
          h("td", {}, h("span", { class: `amount ${credit ? "credit" : "debit"}` }, `${credit ? "+" : "−"} ${display(entry.money.amount)}`)),
          h("td", { class: "muted" }, display(entry.balanceBefore.amount)),
          h("td", {}, h("strong", {}, display(entry.balanceAfter.amount, entry.balanceAfter.currency))),
        );
      }),
    );
    if (this.entries.length === 0) replace(this.body, h("tr", {}, h("td", { colspan: 5, class: "empty" }, "Sem lançamentos.")));

    const more = h("button", { class: "btn ghost" }, "Carregar mais");
    more.addEventListener("click", () => void busy(more, () => this.loadPage()));
    replace(
      this.footer,
      h("small", { class: "muted" }, `${this.entries.length} lançamento(s) carregado(s) · paginação por cursor`),
      this.cursor ? more : null,
    );
  }
}

export { LedgerTab };
