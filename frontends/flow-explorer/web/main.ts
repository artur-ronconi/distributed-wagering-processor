import { api } from "./api";
import { scenarios } from "./flows/scenarios";
import type { RunContext } from "./flows/sink";
import { Trace } from "./flows/trace";
import { session } from "./state";
import { setRepoRoot } from "./ui/code-view";
import { Detail } from "./ui/detail";
import { Diagram } from "./ui/diagram";
import { byId, clear, h } from "./ui/dom";
import { refreshDatalists, renderOperationForm, renderScenarioForm } from "./ui/forms";
import { operations } from "./ui/operations";
import { Player } from "./ui/player";
import { Results } from "./ui/results";
import { Sidebar, type Selection } from "./ui/sidebar";

const diagram = new Diagram(byId<HTMLElement>("diagram") as unknown as SVGSVGElement, byId("lanes-header"), byId("diagram-scroll"));
const detail = new Detail(byId("detail"));
const results = new Results(byId("results"));
const requestCard = byId("request-card");

const player = new Player(byId("player"), (state) => {
  diagram.render(state.steps, state);
  detail.show(state.steps[state.selected ?? state.current]);
});
diagram.setOnSelect((index) => player.select(index));

let busy = false;
let selection: Selection = { type: "operation", id: "create-wallet" };

const showSelection = () => {
  if (selection.type === "operation") {
    const op = operations.find((item) => item.id === selection.id);
    if (op) renderOperationForm(requestCard, op, (values) => execute(`${op.method} ${op.path}`, (ctx) => op.run(ctx, values)), busy);
  } else {
    const scenario = scenarios.find((item) => item.id === selection.id);
    if (scenario) renderScenarioForm(requestCard, scenario, () => execute(scenario.title, (ctx) => scenario.run(ctx)), busy);
  }
};

const sidebar = new Sidebar(byId("sidebar"), operations, scenarios, (next) => {
  selection = next;
  showSelection();
});

/** Runs one operation or scenario: a fresh trace, results and animation. */
const execute = async (title: string, run: (ctx: RunContext) => Promise<unknown>) => {
  if (busy) return;
  busy = true;
  showSelection();

  const trace = new Trace(title);
  results.reset(title);
  player.load(trace);
  const ctx: RunContext = { trace, record: (card) => results.add(card) };

  try {
    await run(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace.add(
      { lane: "client", from: "client", kind: "error", title: "falha no visualizador", detail: `O visualizador não conseguiu completar a execução: ${message}` },
      { evidence: "observado", outcome: "fail" },
    );
    results.add({ type: "note", title: "Erro", text: message, tone: "fail" });
  } finally {
    trace.finish();
    busy = false;
    showSelection();
  }
};

const pill = (label: string, probe: { up: boolean; latencyMs?: number; error?: string } | undefined) =>
  h(
    "span",
    { class: `pill ${probe?.up ? "ok" : "fail"}`, title: probe?.error ?? `${probe?.latencyMs ?? "?"} ms` },
    `${probe?.up ? "●" : "○"} ${label}`,
  );

const refreshStatus = async () => {
  const container = byId("status");
  try {
    const status = await api.status();
    if (status.repoRoot) setRepoRoot(status.repoRoot);
    clear(container);
    container.append(pill("API", status.api), pill("PostgreSQL", status.db), pill("SQS", status.sqs));
  } catch {
    clear(container);
    container.append(h("span", { class: "pill fail" }, "○ servidor do visualizador fora do ar"));
  }
};

session.onChange(refreshDatalists);
refreshDatalists();
sidebar.select(selection);
void refreshStatus();
setInterval(refreshStatus, 5_000);
