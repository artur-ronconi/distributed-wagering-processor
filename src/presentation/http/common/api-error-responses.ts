import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";

import { FailureCode } from "../../../domain/shared/failure-code";
import { ErrorResponseDto } from "../dtos/error-response.dto";

const EXAMPLE_CORRELATION_ID = "c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f";

const ERROR_MESSAGES: Partial<Record<FailureCode, string>> = {
  [FailureCode.InvalidPayload]: 'Amount must be a non-negative decimal string with exactly 2 decimal places, e.g. "25.00".',
  [FailureCode.InvalidAmount]: "Amount must be positive (LOSS accepts 0.00).",
  [FailureCode.WalletNotFound]: "Wallet does not exist.",
  [FailureCode.TransactionNotFound]: "Wager transaction does not exist.",
  [FailureCode.IdempotencyConflict]: "Idempotency-Key already used with a different payload.",
  [FailureCode.WalletAlreadyExists]: "The player already has a wallet in this currency.",
  [FailureCode.TransientFailure]: "Temporary infrastructure failure. Retry with the same Idempotency-Key.",
  [FailureCode.InternalError]: "Unexpected error.",
};

const STATUS_DESCRIPTIONS: Record<number, string> = {
  400: "Invalid payload. Fix the request before sending it again.",
  404: "Not found.",
  409: "Conflict. Do not resend the same request.",
  503: "Transient infrastructure failure (database or SQS). Retry after `Retry-After` seconds with the same Idempotency-Key.",
  500: "Unexpected error. Safe to retry with the same Idempotency-Key.",
};

/** Documents an error status with the standard body and one named example per failure code. */
const ApiErrorResponse = (status: number, codes: FailureCode[], description = STATUS_DESCRIPTIONS[status]) =>
  ApiResponse({
    status,
    description,
    type: ErrorResponseDto,
    ...(status === 503
      ? { headers: { "Retry-After": { description: "Seconds to wait before retrying", schema: { type: "integer", example: 1 } } } }
      : {}),
    examples: Object.fromEntries(
      codes.map((code) => [
        code,
        { summary: code, value: { code, message: ERROR_MESSAGES[code] ?? code, correlationId: EXAMPLE_CORRELATION_ID } },
      ]),
    ),
  });

/** 503 and 500, present on every route that touches the database. */
const ApiInfrastructureErrors = () =>
  applyDecorators(
    ApiErrorResponse(503, [FailureCode.TransientFailure]),
    ApiErrorResponse(500, [FailureCode.InternalError]),
  );

export { ApiErrorResponse, ApiInfrastructureErrors, EXAMPLE_CORRELATION_ID };
