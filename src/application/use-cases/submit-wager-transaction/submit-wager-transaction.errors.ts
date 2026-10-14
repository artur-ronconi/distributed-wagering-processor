import { HttpStatus } from "ddd-tool-kit";

import { type IDomainError } from "../../../domain/shared/domain-error";
import { FailureCode } from "../../../domain/shared/failure-code";

const MISSING_IDEMPOTENCY_KEY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "The Idempotency-Key header is required (1 to 256 characters).",
  statusCode: HttpStatus.BAD_REQUEST,
};

const FIELD_TOO_LONG: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "providerId, externalTransactionId, playerId, roundId, gameId and referenceExternalTransactionId accept up to 128 characters.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const EXTERNAL_ID_ALREADY_USED: IDomainError = {
  code: FailureCode.IdempotencyConflict,
  message: "This providerId + externalTransactionId was already submitted with another Idempotency-Key.",
  statusCode: HttpStatus.CONFLICT,
};

export { MISSING_IDEMPOTENCY_KEY, FIELD_TOO_LONG, EXTERNAL_ID_ALREADY_USED };
