import { type LedgerCursor } from "../../services/wallet-ledger.query";

/** Opaque, stable cursor: base64url of {"c": createdAt ISO, "i": id}. Clients must not parse it. */
const encodeLedgerCursor = (cursor: LedgerCursor): string =>
  Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString("base64url");

const decodeLedgerCursor = (value: string): LedgerCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string" || parsed.i.length !== 16) return null;
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
};

export { encodeLedgerCursor, decodeLedgerCursor };
