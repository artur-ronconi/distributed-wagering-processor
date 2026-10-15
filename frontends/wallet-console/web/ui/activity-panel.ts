import { activity, type ActivityEntry } from "../activity";
import { h, json, rich, time } from "./dom";

const statusClass = (status: number) => (status === 0 ? "s5" : status >= 500 ? "s5" : status >= 400 ? "s4" : status === 202 ? "s3" : "s2");

/** Right column: every request, its status and what it meant. */
class ActivityPanel {
  private readonly list = h("div", { class: "activity-list" });

  constructor(container: HTMLElement) {
    container.append(
      h("div", { class: "side-title" }, "O que o backend respondeu"),
      h("p", { class: "muted small" }, "Cada requisição feita por este console, a mais nova em cima."),
      this.list,
    );
    this.list.append(h("p", { class: "empty" }, "Nada ainda."));
    activity.onAdd((entry) => this.prepend(entry));
  }

  private prepend(entry: ActivityEntry) {
    this.list.querySelector(".empty")?.remove();
    const { call, explanation } = entry;
    const item = h(
      "details",
      { class: `activity-item ${explanation.tone}` },
      h(
        "summary",
        {},
        h("span", { class: `status ${statusClass(call.status)}` }, call.status || "—"),
        h("span", { class: "activity-title" }, entry.title),
        h("small", { class: "muted" }, time(entry.at)),
      ),
      h("p", { class: "activity-explain" }, h("strong", {}, explanation.title), " ", rich(explanation.text)),
      h(
        "div",
        { class: "activity-raw" },
        h("code", { class: "req-line" }, `${call.method} ${call.path} · ${call.durationMs} ms`),
        Object.keys(call.headers).length ? h("pre", { class: "json" }, Object.entries(call.headers).map(([k, v]) => `${k}: ${v}`).join("\n")) : null,
        call.requestBody !== undefined ? h("pre", { class: "json" }, json(call.requestBody)) : null,
        h("small", { class: "muted" }, "resposta"),
        h("pre", { class: "json" }, json(call.data ?? call.error)),
      ),
    );
    this.list.prepend(item);
    item.classList.add("fresh");
    setTimeout(() => item.classList.remove("fresh"), 1200);
  }
}

export { ActivityPanel };
