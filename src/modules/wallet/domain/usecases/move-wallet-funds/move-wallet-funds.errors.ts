import { HttpStatus } from "ddd-tool-kit";

import { type IDomainError } from "../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../shared/domain/failure-code";

const MISSING_IDEMPOTENCY_KEY: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "The Idempotency-Key header is required (1 to 256 characters).",
  statusCode: HttpStatus.BAD_REQUEST,
};

export { MISSING_IDEMPOTENCY_KEY };
