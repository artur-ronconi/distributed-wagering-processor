import { createHash } from "node:crypto";

import { type MoneyProps } from "../../domain/money/money.props";

/** Business fields that identify a wager operation. Headers and transport metadata are excluded. */
interface WagerBusinessFields {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

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

/** SHA-256 (hex) of the canonical JSON of the business fields only. Same hash for HTTP and SQS. */
const wagerPayloadHash = (fields: WagerBusinessFields): string =>
  createHash("sha256")
    .update(
      canonicalize({
        providerId: fields.providerId,
        externalTransactionId: fields.externalTransactionId,
        playerId: fields.playerId,
        walletId: fields.walletId,
        roundId: fields.roundId,
        gameId: fields.gameId,
        kind: fields.kind,
        money: { amount: fields.money.amount, currency: fields.money.currency },
        referenceExternalTransactionId: fields.referenceExternalTransactionId,
      }),
    )
    .digest("hex");

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export { type WagerBusinessFields, canonicalize, wagerPayloadHash, sha256 };
