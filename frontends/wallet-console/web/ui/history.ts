import { resend, rollback, type Outcome } from "../actions";
import { display } from "../money";
import { failureText, KIND_HELP } from "../rules";
import { store, type ConsoleTransaction, type ConsoleWallet } from "../store";
import { explanationCard, kindBadge, movement, statusBadge } from "./badges";
import { busy, h, json, replace, time } from "./dom";

type Filter = "all" | "PROCESSED" | "REJECTED" | "PENDING_REFERENCE";

const FILTERS: Array<[Filter, string]> = [
  ["all", "Todas"],
  ["PROCESSED", "Processadas"],
  ["REJECTED", "Rejeitadas"],
  ["PENDING_REFERENCE", "Aguardando"],
];

const REVERSIBLE = ["BET", "WIN", "REFUND"];

/** Every transaction this console sent for the wallet, including the ones that never touched the balance. */
class HistoryTab {
  readonly element = h("div", { class: "tab-history" });
  private filter: Filter = "all";
  private expanded: string | null = null;
  private readonly filters = h("div", { class: "filters" });
  private readonly table = h("div", { class: "tx-table" });
  private readonly result = h("div", { class: "outcome" });

  constructor(private readonly wallet: ConsoleWallet) {
    this.element.append(
      h(
        "p",
        { class: "muted small" },
        "Tudo o que você enviou, inclusive as rejeitadas e as derrotas: elas ficam registradas mesmo sem mexer no saldo. ",
        h("strong", {}, "Reenviar"),
        " manda exatamente a mesma requisição (mesma Idempotency-Key) para ver a idempotência funcionando.",
      ),
      this.result,
      this.filters,
      this.table,
    );
    this.refresh();
  }

  refresh() {
    const all = store.transactionsOf(this.wallet.id);
    replace(
      this.filters,
      ...FILTERS.map(([filter, label]) => {
        const count = filter === "all" ? all.length : all.filter((tx) => tx.status === filter).length;
        return h(
          "button",
          {
            class: `filter${this.filter === filter ? " active" : ""}`,
            onclick: () => {
              this.filter = filter;
              this.refresh();
            },
          },
          `${label} `,
          h("span", { class: "count" }, count),
        );
      }),
    );

    const visible = this.filter === "all" ? all : all.filter((tx) => tx.status === this.filter);
    replace(
      this.table,
      visible.length === 0
        ? h("p", { class: "empty" }, "Nenhuma transação aqui.")
        : h(
            "table",
            {},
            h(
              "thead",
              {},
              h("tr", {}, ...["Quando", "Tipo", "Valor", "Situação", "Saldo visto", "Rodada", ""].map((title) => h("th", {}, title))),
            ),
            h("tbody", {}, ...visible.flatMap((tx) => this.row(tx))),
          ),
    );
  }

  private row(tx: ConsoleTransaction) {
    const isOpen = this.expanded === tx.externalTransactionId;
    const actions = h("div", { class: "row-actions" });
    const act = (label: string, run: () => Promise<Outcome>, title: string) => {
      const button = h("button", { class: "btn mini", title }, label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void busy(button, async () => replace(this.result, explanationCard((await run()).explanation)));
      });
      return button;
    };
    actions.append(act("Reenviar", () => resend(tx), "Mesma requisição, mesma Idempotency-Key"));
    if (tx.status === "PROCESSED" && REVERSIBLE.includes(tx.kind)) {
      actions.append(act("Estornar", () => rollback(tx), "ROLLBACK desta transação"));
    }

    const main = h(
      "tr",
      {
        class: `tx-row${isOpen ? " open" : ""}`,
        onclick: () => {
          this.expanded = isOpen ? null : tx.externalTransactionId;
          this.refresh();
        },
      },
      h("td", { class: "muted" }, time(tx.createdAt)),
      h("td", {}, kindBadge(tx.kind)),
      h("td", {}, movement(tx)),
      h(
        "td",
        {},
        statusBadge(tx.status),
        tx.failureCode ? h("small", { class: "reason" }, tx.failureCode) : null,
        tx.replays > 0 ? h("small", { class: "replays", title: "reenvios reconhecidos como o mesmo pedido" }, `↺ ${tx.replays}`) : null,
      ),
      h("td", {}, display(tx.observedBalance)),
      h("td", {}, h("code", { class: "muted" }, tx.roundId)),
      h("td", {}, actions),
    );
    if (!isOpen) return [main];

    const detail = h(
      "tr",
      { class: "tx-detail" },
      h(
        "td",
        { colspan: 7 },
        h(
          "div",
          { class: "detail-grid" },
          h(
            "dl",
            {},
            h("dt", {}, "O que é"),
            h("dd", {}, KIND_HELP[tx.kind] ?? ""),
            tx.failureCode ? h("dt", {}, "Por que") : null,
            tx.failureCode ? h("dd", {}, failureText(tx.failureCode)) : null,
            h("dt", {}, "externalTransactionId"),
            h("dd", {}, h("code", {}, tx.externalTransactionId)),
            h("dt", {}, "Idempotency-Key"),
            h("dd", {}, h("code", {}, tx.idempotencyKey)),
            h("dt", {}, "id interno"),
            h("dd", {}, h("code", {}, tx.transactionId ?? "—")),
            tx.referenceExternalTransactionId ? h("dt", {}, "referência") : null,
            tx.referenceExternalTransactionId ? h("dd", {}, h("code", {}, tx.referenceExternalTransactionId)) : null,
          ),
          h("pre", { class: "json" }, json(tx.payload)),
        ),
      ),
    );
    return [main, detail];
  }
}

export { HistoryTab };
