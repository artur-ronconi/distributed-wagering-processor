import type { Scenario } from "../flows/scenarios";
import { session } from "../state";
import { append, clear, h, json, rich } from "./dom";
import type { Field, Operation, Values } from "./operations";

/** Datalists shared by every form, filled with what this session created. */
const refreshDatalists = () => {
  const { wallets, transactions } = session.get();
  const fill = (id: string, items: Array<{ value: string; label: string }>) => {
    let list = document.getElementById(id) as HTMLDataListElement | null;
    if (!list) {
      list = h("datalist", { id });
      document.body.append(list);
    }
    clear(list);
    for (const item of items) list.append(h("option", { value: item.value }, item.label));
  };
  fill("dl-wallets", wallets.map((w) => ({ value: w.id, label: `${w.balance} ${w.currency} · ${w.playerId.slice(0, 8)}…` })));
  fill("dl-transactions", transactions.map((t) => ({ value: t.transactionId, label: `${t.kind} ${t.amount} · ${t.status} · ${t.externalTransactionId}` })));
  fill("dl-external", transactions.map((t) => ({ value: t.externalTransactionId, label: `${t.kind} ${t.amount} · ${t.status} · ${t.roundId}` })));
};

const LIST_FOR: Partial<Record<NonNullable<Field["kind"]>, string>> = {
  wallet: "dl-wallets",
  transaction: "dl-transactions",
  reference: "dl-external",
  external: "dl-external",
};

const renderOperationForm = (container: HTMLElement, op: Operation, onRun: (values: Values) => void, busy: boolean) => {
  clear(container);
  const values: Values = Object.fromEntries(op.fields.map((field) => [field.name, field.initial()]));
  op.derive?.(values, "*");

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const preview = h("pre", { class: "json preview" });

  const sync = () => {
    for (const [name, input] of inputs) if (input.value !== values[name]) input.value = values[name] ?? "";
    if (op.preview) {
      const p = op.preview(values);
      const lines = [`${p.method} ${p.target}`];
      for (const [key, value] of Object.entries(p.headers ?? {})) lines.push(`${key}: ${value}`);
      if (p.body !== undefined) lines.push("", json(p.body));
      preview.textContent = lines.join("\n");
    }
  };

  const onChange = (name: string, value: string) => {
    values[name] = value;
    op.derive?.(values, name);
    sync();
  };

  const field = (f: Field) => {
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.kind === "select") {
      input = h("select", { name: f.name }, ...(f.options ?? []).map((option) => h("option", { value: option }, option)));
      input.addEventListener("change", () => onChange(f.name, input.value));
    } else {
      input = h("input", { name: f.name, autocomplete: "off", spellcheck: "false", list: f.kind ? LIST_FOR[f.kind] : undefined });
      input.addEventListener("input", () => onChange(f.name, input.value));
    }
    inputs.set(f.name, input);
    return h(
      "label",
      { class: `field${f.wide ? " wide" : ""}` },
      h("span", { class: "field-label" }, f.label),
      h(
        "span",
        { class: "field-input" },
        input,
        f.regenerate
          ? h("button", { type: "button", class: "btn icon small", title: "gerar outro", onclick: () => onChange(f.name, f.initial()) }, "↻")
          : null,
      ),
      f.help ? h("small", { class: "field-help" }, f.help) : null,
    );
  };

  const run = h("button", { class: "btn primary", disabled: busy, onclick: () => onRun({ ...values }) }, busy ? "executando…" : "Executar ▶");

  append(container, [
    h(
      "div",
      { class: "request-head" },
      h("span", { class: `method m-${op.method.toLowerCase()}` }, op.method),
      h("code", { class: "path" }, op.path),
      h("span", { class: "spacer" }),
      run,
    ),
    h("p", { class: "request-desc" }, rich(op.description)),
    op.fields.length > 0 ? h("div", { class: "fields" }, ...op.fields.map(field)) : null,
    op.preview ? h("details", { class: "raw" }, h("summary", {}, "requisição que será enviada"), preview) : null,
  ]);
  sync();
};

const renderScenarioForm = (container: HTMLElement, scenario: Scenario, onRun: () => void, busy: boolean) => {
  clear(container);
  container.append(
    h(
      "div",
      { class: "request-head" },
      h("span", { class: "method m-scenario" }, "CENÁRIO"),
      h("strong", { class: "path" }, scenario.title),
      h("span", { class: "spacer" }),
      h("button", { class: "btn primary", disabled: busy, onclick: onRun }, busy ? "executando…" : "Rodar cenário ▶"),
    ),
    h("p", { class: "request-desc" }, rich(scenario.summary)),
    h("p", { class: "request-desc muted" }, "Cria uma carteira nova para o cenário, então pode rodar quantas vezes quiser."),
  );
};

export { refreshDatalists, renderOperationForm, renderScenarioForm };
