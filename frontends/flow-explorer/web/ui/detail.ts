import { LANES } from "../flows/lanes";
import type { TraceStep } from "../flows/types";
import { codeView } from "./code-view";
import { append, clear, h, json, rich } from "./dom";
import { highlightSql } from "./highlight";

const KIND_LABEL: Record<string, string> = {
  call: "chamada",
  return: "retorno",
  db: "banco",
  decision: "decisão",
  error: "erro",
  async: "assíncrono",
  wait: "espera",
  domain: "domínio",
};

/** Right panel: everything about one step. */
class Detail {
  private shownId: number | null = null;

  constructor(private readonly container: HTMLElement) {
    this.empty();
  }

  empty() {
    this.shownId = null;
    clear(this.container);
    this.container.append(
      h(
        "div",
        { class: "detail-empty" },
        h("h3", {}, "Como usar"),
        h("p", {}, "Escolha uma rota ou um cenário à esquerda e execute. O diagrama anima, passo a passo, o caminho que a requisição percorreu no backend."),
        h(
          "ul",
          {},
          h("li", {}, rich("Cada passo mostra o **código real** do `src/` e o SQL equivalente.")),
          h("li", {}, rich("**● observado**: confirmado por evidência (resposta HTTP, linha no Postgres, fila, log).")),
          h("li", {}, rich("**○ inferido**: o caminho do código implicado por essa evidência. O backend não foi instrumentado.")),
          h("li", {}, rich("Clique numa linha do diagrama para inspecioná-la. Atalhos: `espaço`, `←` e `→`.")),
        ),
      ),
    );
  }

  show(step: TraceStep | undefined) {
    if (!step) return this.empty();
    if (step.id === this.shownId) return;
    this.shownId = step.id;
    clear(this.container);

    if (step.section) {
      this.container.append(h("div", { class: "detail-section" }, h("small", {}, "parte do cenário"), h("h2", {}, step.section)));
      return;
    }

    const lane = LANES.find((item) => item.id === step.lane);
    const from = LANES.find((item) => item.id === step.from);
    const badges = h(
      "div",
      { class: "badges" },
      h("span", { class: `badge lane-badge lane-${step.lane}` }, from && from.id !== lane?.id ? `${from.label} → ${lane?.label}` : lane?.label ?? step.lane),
      h("span", { class: `badge kind-badge k-${step.kind ?? "call"}` }, KIND_LABEL[step.kind ?? "call"] ?? step.kind),
      h("span", { class: `badge ev-badge ${step.evidence}` }, step.evidence === "observado" ? "● observado" : "○ inferido"),
      step.track ? h("span", { class: `badge track-badge track-${step.track}` }, `requisição ${step.track}`) : null,
      step.tx ? h("span", { class: `badge tx-badge tx-${step.tx}` }, step.tx.toUpperCase()) : null,
      step.lock ? h("span", { class: "badge lock-badge" }, step.lock === "acquire" ? "🔒 lock" : step.lock === "wait" ? "⏳ esperando lock" : "🔓 libera lock") : null,
    );

    append(this.container, [
      badges,
      h("h2", { class: `detail-title${step.outcome === "fail" ? " fail" : ""}` }, step.title),
      step.note ? h("div", { class: "detail-note" }, step.note) : null,
      step.branch
        ? h(
            "div",
            { class: `branch ${step.outcome === "fail" ? "fail" : "ok"}` },
            h("span", { class: "q" }, `◆ ${step.branch.question}`),
            h("span", { class: "a" }, `→ ${step.branch.answer}`),
          )
        : null,
      step.detail ? h("p", { class: "detail-text" }, rich(step.detail)) : null,
      step.code ? codeView(step.code) : null,
      step.sql ? this.sql(step.sql) : null,
      step.data !== undefined ? this.data(step.data) : null,
    ]);
  }

  private sql(sql: string) {
    const pre = h("pre", { class: "sql" });
    pre.innerHTML = highlightSql(sql);
    return h("div", { class: "block" }, h("div", { class: "block-title" }, "SQL equivalente"), pre);
  }

  private data(data: unknown) {
    return h(
      "details",
      { class: "block", open: true },
      h("summary", { class: "block-title" }, "Evidência / dados"),
      h("pre", { class: "json" }, json(data)),
    );
  }
}

export { Detail };
