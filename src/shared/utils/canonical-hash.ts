import { createHash } from "node:crypto";

/** JSON with keys sorted at every level, no whitespace, undefined fields omitted. */
const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export { canonicalize, sha256 };
