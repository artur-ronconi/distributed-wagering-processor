type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Tiny hyperscript: h("div", { class: "x", onclick: fn }, "text", child). */
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
};

const append = (parent: Node, children: Child[]) => {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
};

const clear = (element: Element) => {
  while (element.firstChild) element.removeChild(element.firstChild);
};

const replace = (element: Element, ...children: Child[]) => {
  clear(element);
  append(element, children);
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `code` and **bold** in texts written by us. */
const rich = (text: string) => {
  const span = document.createElement("span");
  span.innerHTML = escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return span;
};

/** Disables the button (and shows a spinner) while `work` runs; one action at a time per button. */
const busy = async <T>(button: HTMLButtonElement, work: () => Promise<T>): Promise<T | undefined> => {
  if (button.disabled) return undefined;
  button.disabled = true;
  button.classList.add("loading");
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
};

const time = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const json = (value: unknown) => JSON.stringify(value, null, 2);

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} not found`);
  return element as T;
};

export { append, busy, byId, clear, h, json, replace, rich, time };
