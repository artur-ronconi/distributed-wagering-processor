import { pollPending, refreshWallet } from "./actions";
import { api } from "./api";
import { store, type ConsoleWallet } from "./store";
import { ActivityPanel } from "./ui/activity-panel";
import { byId, h, replace } from "./ui/dom";
import { HistoryTab } from "./ui/history";
import { LabTab } from "./ui/lab";
import { LedgerTab } from "./ui/ledger";
import { PlayTab } from "./ui/play";
import { rulesTab } from "./ui/rules-tab";
import { newWalletForm, Sidebar } from "./ui/sidebar";
import { WalletHeader } from "./ui/wallet-header";

type TabId = "play" | "history" | "ledger" | "lab" | "rules";

const TABS: Array<[TabId, string]> = [
  ["play", "Jogar"],
  ["history", "Transações"],
  ["ledger", "Extrato"],
  ["lab", "Laboratório"],
  ["rules", "Regras"],
];

const main = byId("main");
new Sidebar(byId("sidebar"));
new ActivityPanel(byId("activity"));

let tab: TabId = "play";
let view: {
  walletId: string;
  header: WalletHeader;
  play: PlayTab;
  history: HistoryTab;
  ledger: LedgerTab;
  lab: LabTab;
  rules: HTMLElement;
  tabBar: HTMLElement;
  content: HTMLElement;
} | null = null;

const emptyState = () =>
  replace(
    main,
    h(
      "section",
      { class: "empty-state card" },
      h("span", { class: "hero-icon" }, "👛"),
      h("h1", {}, "Crie sua primeira carteira"),
      h(
        "p",
        { class: "muted" },
        "Aqui você opera como um cassino: abre carteiras, aposta, ganha, perde, pede reembolso, estorna, e vê como o backend aplica cada regra de negócio.",
      ),
      newWalletForm(),
    ),
  );

const showTab = (next: TabId) => {
  if (!view) return;
  tab = next;
  view.tabBar.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.tab === next));
  const element = { play: view.play.element, history: view.history.element, ledger: view.ledger.element, lab: view.lab.element, rules: view.rules }[next];
  replace(view.content, element);
  if (next === "ledger") void view.ledger.reload();
};

const openWallet = (wallet: ConsoleWallet) => {
  const tabBar = h(
    "nav",
    { class: "tabs" },
    ...TABS.map(([id, label]) => h("button", { class: "tab", "data-tab": id, onclick: () => showTab(id) }, label)),
  );
  const content = h("div", { class: "tab-content" });
  view = {
    walletId: wallet.id,
    header: new WalletHeader(wallet),
    play: new PlayTab(wallet),
    history: new HistoryTab(wallet),
    ledger: new LedgerTab(wallet),
    lab: new LabTab(wallet),
    rules: rulesTab(),
    tabBar,
    content,
  };
  replace(main, view.header.element, tabBar, content);
  showTab(tab);
  void refreshWallet(wallet.id);
};

let lastVersion = "";
const render = () => {
  const wallet = store.selectedWallet() ?? store.get().wallets[0] ?? null;
  if (!wallet) {
    view = null;
    return emptyState();
  }
  if (!view || view.walletId !== wallet.id) return openWallet(wallet);

  view.header.refresh();
  view.play.refresh();
  view.history.refresh();
  // The statement only changes when the balance does.
  const version = `${wallet.id}:${wallet.version}`;
  if (tab === "ledger" && version !== lastVersion) void view.ledger.reload();
  lastVersion = version;
};

store.onChange(render);
render();

const refreshStatus = async () => {
  const call = await api.health();
  const pill = byId("api-status");
  pill.className = `pill ${call.ok ? "ok" : "fail"}`;
  pill.textContent = call.ok ? "● backend no ar" : "○ backend fora do ar";
};
void refreshStatus();
setInterval(refreshStatus, 10_000);

// Transactions waiting for their reference are finished by a backend worker: keep asking.
setInterval(() => {
  if (store.get().transactions.some((tx) => tx.status === "PENDING_REFERENCE")) void pollPending();
}, 1_500);
