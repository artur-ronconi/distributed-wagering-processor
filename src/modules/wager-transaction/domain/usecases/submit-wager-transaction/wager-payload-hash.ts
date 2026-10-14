import { canonicalize, sha256 } from "../../../../../shared/utils/canonical-hash";
import { type MoneyProps } from "../../../../wallet/domain/aggregate/value-objects/money/money.props";

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

/** SHA-256 (hex) of the canonical JSON of the business fields only. Same hash for HTTP and SQS. */
const wagerPayloadHash = (fields: WagerBusinessFields): string =>
  sha256(
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
  );

export { type WagerBusinessFields, wagerPayloadHash };
