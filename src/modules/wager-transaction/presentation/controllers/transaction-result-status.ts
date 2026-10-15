import { HttpStatus } from "@nestjs/common";

import { WagerTransactionStatus } from "../../domain/aggregate/aggregate-root/wager-transaction.enums";
import { type WagerTransactionResultView } from "../../domain/mappers/wager-transaction-view.mapper";

/**
 * HTTP status of a transaction result: REJECTED → 422 (result in the body), PENDING_REFERENCE → 202,
 * replay → 200, new → 201. Shared by the wager route and the wallet deposit/withdrawal routes.
 */
const statusFor = ({ status, idempotentReplay }: WagerTransactionResultView): number => {
  if (status === WagerTransactionStatus.Rejected) return HttpStatus.UNPROCESSABLE_ENTITY;
  if (status === WagerTransactionStatus.PendingReference) return HttpStatus.ACCEPTED;
  return idempotentReplay ? HttpStatus.OK : HttpStatus.CREATED;
};

export { statusFor };
