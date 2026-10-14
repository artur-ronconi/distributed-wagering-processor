import { HttpStatus } from "ddd-tool-kit";

import { type IDomainError } from "../domain/domain-error";
import { FailureCode } from "../domain/failure-code";

const TRANSIENT_FAILURE: IDomainError = {
  code: FailureCode.TransientFailure,
  message: "Temporary infrastructure failure. Retry with the same Idempotency-Key.",
  statusCode: HttpStatus.SERVICE_UNAVAILABLE,
};

const INTERNAL_ERROR: IDomainError = {
  code: FailureCode.InternalError,
  message: "Unexpected error.",
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

const INVALID_ID: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Invalid id: expected a 16-character identifier.",
  statusCode: HttpStatus.BAD_REQUEST,
};

export { TRANSIENT_FAILURE, INTERNAL_ERROR, INVALID_ID };
