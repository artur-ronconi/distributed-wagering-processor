import { api } from "../api";
import type { CodeRef } from "../flows/types";
import { h } from "./dom";
import { highlight } from "./highlight";

const CONTEXT_BEFORE = 6;
const CONTEXT_AFTER = 8;

const cache = new Map<string, Promise<{ raw: string[]; html: string[] } | null>>();

const load = (file: string) => {
  let entry = cache.get(file);
  if (!entry) {
    entry = api.source(file).then((text) => (text === null ? null : { raw: text.split("\n"), html: highlight(text) }));
    cache.set(file, entry);
  }
  return entry;
};

/** 0-based line of the anchor, or -1. */
const locate = (lines: string[], ref: CodeRef) => {
  const start = ref.after ? Math.max(0, lines.findIndex((line) => line.includes(ref.after as string))) : 0;
  return lines.findIndex((line, index) => index >= start && line.includes(ref.anchor));
};

let repoRoot = "";
const setRepoRoot = (root: string) => {
  repoRoot = root;
};

/** Real backend code around the anchor, with the step's lines highlighted. */
const codeView = (ref: CodeRef): HTMLElement => {
  const body = h("div", { class: "code-body" }, h("div", { class: "code-loading" }, "carregando código…"));
  const location = h("span", { class: "code-loc" }, ref.file);
  const box = h("div", { class: "code" }, h("div", { class: "code-head" }, location), body);

  void load(ref.file).then((source) => {
    body.textContent = "";
    if (!source) {
      body.append(h("div", { class: "code-loading" }, "arquivo não encontrado"));
      return;
    }
    const index = locate(source.raw, ref);
    if (index < 0) {
      body.append(h("div", { class: "code-loading warn" }, `trecho "${ref.anchor}" não encontrado: o código mudou?`));
      return;
    }
    const span = ref.span ?? 1;
    const from = Math.max(0, index - CONTEXT_BEFORE);
    const to = Math.min(source.raw.length, index + span + CONTEXT_AFTER);
    location.textContent = `${ref.file}:${index + 1}`;
    if (repoRoot) {
      location.replaceWith(
        h("a", { class: "code-loc", href: `vscode://file/${repoRoot}/${ref.file}:${index + 1}`, title: "abrir no VS Code" }, `${ref.file}:${index + 1}`),
      );
    }

    const table = h("div", { class: "code-lines" });
    for (let line = from; line < to; line += 1) {
      const active = line >= index && line < index + span;
      const row = h("div", { class: active ? "code-line active" : "code-line" }, h("span", { class: "ln" }, line + 1));
      const content = h("span", { class: "lc" });
      content.innerHTML = source.html[line] || " ";
      row.append(content);
      table.append(row);
    }
    body.append(table);
  });

  return box;
};

export { codeView, setRepoRoot };
