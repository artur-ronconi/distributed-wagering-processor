import { escapeHtml } from "./dom";

const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const constructor continue default do else enum export extends " +
    "false finally for from function get if implements import in instanceof interface let new null of private " +
    "protected public readonly return satisfies set static super switch this throw true try type typeof undefined " +
    "var void while"
  ).split(" "),
);

const TOKEN =
  /(\/\/.*$)|(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(@[A-Za-z_]\w*)|(\b\d[\d_.]*n?\b)|([A-Za-z_$][\w$]*)/g;

/**
 * Highlights one line of TypeScript. `inComment` carries block comments across lines.
 * Good enough for reading code, not a parser.
 */
const highlightLine = (line: string, inComment: boolean): { html: string; inComment: boolean } => {
  let html = "";
  let rest = line;

  if (inComment) {
    const end = rest.indexOf("*/");
    if (end < 0) return { html: `<span class="t-com">${escapeHtml(rest)}</span>`, inComment: true };
    html += `<span class="t-com">${escapeHtml(rest.slice(0, end + 2))}</span>`;
    rest = rest.slice(end + 2);
  }

  const open = rest.search(/\/\*(?!.*\*\/)/);
  let tail = "";
  let stillOpen = false;
  if (open >= 0 && !/\/\/.*\/\*/.test(rest.slice(0, open + 2))) {
    tail = rest.slice(open);
    rest = rest.slice(0, open);
    stillOpen = true;
  }

  let last = 0;
  for (const match of rest.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    html += escapeHtml(rest.slice(last, index));
    const [text, comment, block, string, decorator, number, word] = match;
    let cls = "";
    if (comment || block) cls = "t-com";
    else if (string) cls = "t-str";
    else if (decorator) cls = "t-dec";
    else if (number) cls = "t-num";
    else if (word && KEYWORDS.has(word)) cls = "t-kw";
    else if (word && /^[A-Z]/.test(word)) cls = "t-type";
    else if (word && rest[index + word.length] === "(") cls = "t-fn";
    html += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    last = index + text.length;
  }
  html += escapeHtml(rest.slice(last));
  if (tail) html += `<span class="t-com">${escapeHtml(tail)}</span>`;
  return { html, inComment: stillOpen };
};

/** Highlights a whole file, line by line. */
const highlight = (source: string): string[] => {
  let inComment = false;
  return source.split("\n").map((line) => {
    const result = highlightLine(line, inComment);
    inComment = result.inComment;
    return result.html;
  });
};

const highlightSql = (sql: string) =>
  escapeHtml(sql).replace(
    /\b(SELECT|FROM|WHERE|AND|OR|IN|INSERT|INTO|VALUES|UPDATE|SET|DELETE|BEGIN|COMMIT|ROLLBACK|FOR UPDATE|SKIP LOCKED|ORDER BY|LIMIT|DESC|ON CONFLICT|DO NOTHING|RETURNING|READ ONLY|LOCAL|CASE|WHEN|THEN|ELSE|END|IS|NULL|NOT|count|sum|coalesce|now)\b/g,
    '<span class="t-kw">$1</span>',
  );

export { highlight, highlightSql };
