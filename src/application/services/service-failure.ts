import { Logger } from "@nestjs/common";
import { type IError, Output } from "ddd-tool-kit";

import { INTERNAL_ERROR, TRANSIENT_FAILURE } from "../errors/common.errors";
import { TransientInfrastructureError } from "../errors/transient-infrastructure.error";

/** Thrown inside uow.transactional to roll back and answer with `output` (nothing is persisted). */
class AbortTransaction extends Error {
  constructor(readonly output: Output<IError>) {
    super("transaction aborted");
    this.name = "AbortTransaction";
  }
}

/** Maps an unexpected error to an Output, keeping transient failures distinguishable (503 vs 500). */
const failureFrom = (error: unknown, logger: Logger, context: Record<string, unknown> = {}): Output<IError> => {
  if (error instanceof AbortTransaction) return error.output;
  if (error instanceof TransientInfrastructureError) {
    logger.warn({ ...context, err: error.message }, "transient infrastructure failure");
    return Output.fail(TRANSIENT_FAILURE);
  }
  logger.error({ ...context, err: error instanceof Error ? { message: error.message, stack: error.stack } : error }, "unexpected error");
  return Output.fail(INTERNAL_ERROR);
};

export { AbortTransaction, failureFrom };
