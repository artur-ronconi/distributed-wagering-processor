import type { HttpExchange, Row } from "../api";
import { invariant, money } from "../flows/format";
import type { ResultCard } from "../flows/sink";
import { clear, h, json } from "./dom";

const statusClass = (status: number) => (status >= 500 ? "s5" : status >= 400 ? "s4" : status >= 300 ? "s3" : "s2");

const raw = (label: string, value: unknown, open = false) =>
  h("details", { class: "raw", open }, h("summary", {}, label), h("pre", { class: "json" }, json(value)));

const kv = (pairs: Array<[string, unknown]>) =>
  h(
    "dl",
    { class: "kv" },
    ...pairs.flatMap(([key, value]) => [h("dt", {}, key), h("dd", {}, value === null || value === undefined ? "—" : String(value))]),
  );

const httpCard = (card: Extract<ResultCard, { type: "http" }>) => {
  const exchange: HttpExchange = card.exchange;
  return h(
    "div",
    { class: "result http" },
    h(
      "div",
      { class: "result-head" },
      card.track ? h("span", { class: `badge track-badge track-${card.track}` }, card.track) : null,
      h("span", { class: `status ${statusClass(exchange.status)}` }, exchange.status),
      h("span", { class: "method" }, exchange.request.method),
      h("code", { class: "path" }, exchange.request.path),
      h("span", { class: "muted" }, `${exchange.durationMs} ms`),
    ),
    kv([
      ["X-Correlation-Id", exchange.headers["x-correlation-id"]],
      ...(exchange.headers["retry-after"] ? ([["Retry-After", exchange.headers["retry-after"]]] as Array<[string, unknown]>) : []),
    ]),
    h(
      "div",
      { class: "two-cols" },
      raw("requisição", { headers: exchange.request.headers, body: exchange.request.body ?? null }),
      raw("resposta", exchange.body, true),
    ),
  );
};

const walletDiff = (before: Row | null | undefined, after: Row | null | undefined) => {
  if (!after) return null;
  const changed = before && (before.balanceAmount !== after.balanceAmount || before.version !== after.version);
  return h(
    "div",
    { class: "diff-row" },
    h("span", { class: "diff-label" }, "wallets"),
    h(
      "span",
      {},
      before ? `${money(before.balanceAmount)} (v${before.version}) → ` : "nova: ",
      h("strong", { class: changed || !before ? "changed" : "" }, `${money(after.balanceAmount, after.currency)} (v${after.version})`),
    ),
  );
};

const table = (rows: Row[], columns: Array<[string, string]>) =>
  h(
    "table",
    { class: "mini" },
    h("thead", {}, h("tr", {}, ...columns.map(([, label]) => h("th", {}, label)))),
    h(
      "tbody",
      {},
      ...rows.map((row) =>
        h(
          "tr",
          {},
          ...columns.map(([key]) => {
            const value = row[key];
            return h("td", {}, value === null || value === undefined ? "—" : value instanceof Object ? JSON.stringify(value) : String(value));
          }),
        ),
      ),
    ),
  );

const snapshotCard = (card: Extract<ResultCard, { type: "snapshot" }>) => {
  const { before, after } = card;
  const check = invariant(after);
  const newOutbox = after.outbox.filter((row) => !before?.outbox.some((old) => old.id === row.id));
  const tx = after.transaction;

  return h(
    "div",
    { class: "result snapshot" },
    h(
      "div",
      { class: "result-head" },
      card.track ? h("span", { class: `badge track-badge track-${card.track}` }, card.track) : null,
      h("strong", {}, card.title),
      check
        ? h("span", { class: `pill ${check.ok ? "ok" : "fail"}` }, check.ok ? `saldo = ledger ✓ (${check.calculated})` : `saldo ${check.stored} ≠ ledger ${check.calculated}`)
        : null,
    ),
    walletDiff(before?.wallet, after.wallet),
    tx
      ? h(
          "div",
          { class: "diff-row" },
          h("span", { class: "diff-label" }, "wager_transactions"),
          h(
            "span",
            {},
            before?.transaction ? `${before.transaction.status} → ` : "nova: ",
            h("strong", { class: "changed" }, `${tx.kind} ${tx.amount} · ${tx.status}${tx.failureCode ? ` · ${tx.failureCode}` : ""}`),
            h("small", { class: "muted" }, ` id ${tx.id}`),
          ),
        )
      : null,
    after.ledger.length > 0
      ? h(
          "div",
          { class: "diff-block" },
          h("span", { class: "diff-label" }, "wallet_ledger_entries"),
          table(after.ledger, [
            ["direction", "direção"],
            ["amount", "valor"],
            ["balanceBeforeAmount", "antes"],
            ["balanceAfterAmount", "depois"],
            ["createdAt", "created_at"],
          ]),
        )
      : null,
    newOutbox.length > 0
      ? h(
          "div",
          { class: "diff-block" },
          h("span", { class: "diff-label" }, "outbox_messages (no commit)"),
          table(newOutbox, [
            ["eventType", "evento"],
            ["aggregateId", "aggregate"],
            ["publishedAt", "published_at"],
            ["attempts", "tentativas"],
          ]),
        )
      : null,
    after.inbox
      ? h(
          "div",
          { class: "diff-row" },
          h("span", { class: "diff-label" }, "inbox_messages"),
          h("span", {}, `${after.inbox.consumerName} · ${after.inbox.messageId} · processed_at ${after.inbox.processedAt ?? "—"}`),
        )
      : null,
    raw("linhas completas (antes e depois)", { before: before ?? null, after }),
  );
};

const render = (card: ResultCard): HTMLElement => {
  switch (card.type) {
    case "http":
      return httpCard(card);
    case "snapshot":
      return snapshotCard(card);
    case "events":
      return h(
        "div",
        { class: "result events" },
        h("div", { class: "result-head" }, h("strong", {}, card.title), h("span", { class: "muted" }, `${card.events.length} evento(s)`)),
        ...card.events.map((event) =>
          raw(`${event.eventType} · group ${event.groupId ?? "—"} · recebido ${new Date(event.receivedAt).toLocaleTimeString()}`, event.payload),
        ),
      );
    case "logs":
      return h("div", { class: "result logs" }, h("div", { class: "result-head" }, h("strong", {}, card.title)), h("pre", { class: "json" }, card.lines.map((line) => JSON.stringify(line)).join("\n")));
    case "message":
      return h(
        "div",
        { class: "result message" },
        h("div", { class: "result-head" }, h("strong", {}, card.title)),
        card.meta ? kv(Object.entries(card.meta)) : null,
        raw("corpo da mensagem", card.payload, true),
      );
    case "note":
      return h("div", { class: `result note ${card.tone ?? ""}` }, h("strong", {}, card.title), h("p", {}, card.text));
  }
};

/** Bottom panel: what was sent and received, and what changed in the database. */
class Results {
  constructor(private readonly container: HTMLElement) {
    this.reset();
  }

  reset(title = "Resultados") {
    clear(this.container);
    this.container.append(h("div", { class: "card-title" }, title), h("div", { class: "results-list" }));
  }

  add(card: ResultCard) {
    this.container.querySelector(".results-list")?.append(render(card));
  }
}

export { Results };
