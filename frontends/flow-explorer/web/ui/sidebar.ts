import type { Scenario } from "../flows/scenarios";
import { session } from "../state";
import { clear, h } from "./dom";
import type { Operation } from "./operations";

type Selection = { type: "operation"; id: string } | { type: "scenario"; id: string };

const GROUPS: Array<{ id: Operation["group"]; title: string }> = [
  { id: "wallets", title: "Carteiras" },
  { id: "transactions", title: "Transações" },
  { id: "queue", title: "Fila SQS" },
  { id: "health", title: "Health" },
];

class Sidebar {
  private selection: Selection | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly operations: Operation[],
    private readonly scenarios: Scenario[],
    private readonly onSelect: (selection: Selection) => void,
  ) {
    session.onChange(() => this.render());
  }

  select(selection: Selection) {
    this.selection = selection;
    this.render();
    this.onSelect(selection);
  }

  render() {
    clear(this.container);
    const isActive = (type: Selection["type"], id: string) => this.selection?.type === type && this.selection.id === id;

    for (const group of GROUPS) {
      const items = this.operations.filter((op) => op.group === group.id);
      this.container.append(
        h("div", { class: "nav-title" }, group.title),
        ...items.map((op) =>
          h(
            "button",
            { class: `nav-item${isActive("operation", op.id) ? " active" : ""}`, onclick: () => this.select({ type: "operation", id: op.id }) },
            h("span", { class: `method m-${op.method.toLowerCase()}` }, op.method),
            h("span", { class: "nav-text" }, h("span", {}, op.title), h("small", {}, op.path)),
          ),
        ),
      );
    }

    this.container.append(
      h("div", { class: "nav-title" }, "Cenários"),
      ...this.scenarios.map((scenario) =>
        h(
          "button",
          { class: `nav-item scenario${isActive("scenario", scenario.id) ? " active" : ""}`, onclick: () => this.select({ type: "scenario", id: scenario.id }) },
          h("span", { class: "method m-scenario" }, "▶"),
          h("span", { class: "nav-text" }, h("span", {}, scenario.title)),
        ),
      ),
    );

    const { wallets } = session.get();
    const current = session.currentWallet();
    this.container.append(
      h(
        "div",
        { class: "nav-title row" },
        h("span", {}, "Carteiras desta sessão"),
        wallets.length > 0 ? h("button", { class: "link", onclick: () => session.clear() }, "limpar") : null,
      ),
      wallets.length === 0
        ? h("p", { class: "muted small pad" }, "Crie uma carteira (ou rode um cenário) e ela aparece aqui.")
        : h(
            "div",
            { class: "wallets" },
            ...wallets.map((wallet) =>
              h(
                "button",
                {
                  class: `wallet${wallet.id === current?.id ? " active" : ""}`,
                  title: `playerId ${wallet.playerId}`,
                  onclick: () => {
                    session.selectWallet(wallet.id);
                    if (this.selection) this.onSelect(this.selection);
                  },
                },
                h("code", {}, wallet.id),
                h("strong", {}, `${wallet.balance} ${wallet.currency}`),
              ),
            ),
          ),
    );
  }
}

export { Sidebar, type Selection };
