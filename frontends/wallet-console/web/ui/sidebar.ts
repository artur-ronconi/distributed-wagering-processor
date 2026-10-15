import { createWallet } from "../actions";
import { display, normalize } from "../money";
import { store } from "../store";
import { explanationCard } from "./badges";
import { busy, h, replace } from "./dom";

const CURRENCIES = ["BRL", "USD", "EUR"];

/** Form to open a wallet. Used in the sidebar and in the empty state. */
const newWalletForm = (onCreated?: () => void) => {
  const nickname = h("input", { placeholder: "ex.: Mesa VIP", maxlength: 40, value: `Carteira ${store.get().wallets.length + 1}` });
  const currency = h("select", {}, ...CURRENCIES.map((code) => h("option", { value: code }, code)));
  const amount = h("input", { value: "100.00", inputmode: "decimal" });
  const feedback = h("div", { class: "form-feedback" });
  const submit = h("button", { class: "btn primary block", type: "submit" }, "Criar carteira");

  const form = h(
    "form",
    {
      class: "new-wallet",
      onsubmit: (event: Event) => {
        event.preventDefault();
        const initial = normalize(amount.value);
        if (!initial) {
          replace(feedback, h("p", { class: "error" }, "Use um valor como 100 ou 100.50 (até 2 casas)."));
          return;
        }
        void busy(submit, async () => {
          const { call, explanation } = await createWallet(nickname.value.trim() || "Sem nome", currency.value, initial);
          replace(feedback, call.ok ? null : explanationCard(explanation));
          if (call.ok) {
            nickname.value = `Carteira ${store.get().wallets.length + 1}`;
            onCreated?.();
          }
        });
      },
    },
    h("label", {}, h("span", {}, "Apelido"), nickname),
    h("div", { class: "row" }, h("label", {}, h("span", {}, "Moeda"), currency), h("label", {}, h("span", {}, "Saldo inicial"), amount)),
    submit,
    h("small", { class: "muted" }, "Cada carteira ganha um jogador próprio (playerId gerado), então você pode abrir quantas quiser."),
    feedback,
  );
  return form;
};

class Sidebar {
  private readonly list = h("div", { class: "wallet-list" });
  private readonly formBox = h("div", { class: "form-box", hidden: true });

  constructor(container: HTMLElement) {
    const toggle = h("button", { class: "btn ghost block", onclick: () => this.toggleForm() }, "+ Nova carteira");
    container.append(
      h("div", { class: "side-title" }, "Minhas carteiras"),
      this.list,
      toggle,
      this.formBox,
      h(
        "div",
        { class: "space-note" },
        h("p", {}, `Seu espaço: `, h("code", {}, store.get().id)),
        h("p", { class: "muted" }, "Só as carteiras criadas neste navegador aparecem aqui. Não existe busca pela carteira de outra pessoa."),
        h(
          "button",
          {
            class: "link",
            onclick: () => {
              if (confirm("Esquecer as carteiras deste espaço? Elas continuam no backend, mas este console deixa de enxergá-las.")) store.reset();
            },
          },
          "Começar um espaço novo",
        ),
      ),
    );
    store.onChange(() => this.render());
    this.render();
  }

  private toggleForm(force?: boolean) {
    const show = force ?? this.formBox.hidden;
    this.formBox.hidden = !show;
    if (show) replace(this.formBox, newWalletForm(() => this.toggleForm(false)));
  }

  private render() {
    const { wallets, selectedWalletId } = store.get();
    replace(
      this.list,
      wallets.length === 0
        ? h("p", { class: "muted small" }, "Nenhuma carteira ainda.")
        : null,
      ...wallets.map((wallet) =>
        h(
          "button",
          { class: `wallet-item${wallet.id === selectedWalletId ? " active" : ""}`, onclick: () => store.selectWallet(wallet.id) },
          h("span", { class: "wallet-name" }, wallet.nickname),
          h("span", { class: "wallet-balance" }, display(wallet.balance, wallet.currency)),
        ),
      ),
    );
  }
}

export { newWalletForm, Sidebar };
