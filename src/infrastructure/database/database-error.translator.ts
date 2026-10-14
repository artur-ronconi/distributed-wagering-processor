import {
  ConnectionException,
  DeadlockException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from "@mikro-orm/core";

import { ConcurrencyConflictError } from "../../application/errors/concurrency-conflict.error";
import { DuplicateKeyError } from "../../application/errors/duplicate-key.error";
import { TransientInfrastructureError } from "../../application/errors/transient-infrastructure.error";

// PostgreSQL SQLSTATEs that may succeed on retry.
const TRANSIENT_SQLSTATES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available (lock_timeout)
  "57014", // query_canceled (statement_timeout)
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "08000", "08001", "08003", "08004", "08006", // connection exceptions
]);

const TRANSIENT_NODE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND"]);

/** Turns driver errors into application errors. Unknown errors are returned untouched. */
const translateDatabaseError = (error: unknown): unknown => {
  if (
    error instanceof TransientInfrastructureError ||
    error instanceof DuplicateKeyError ||
    error instanceof ConcurrencyConflictError
  ) {
    return error;
  }

  if (error instanceof UniqueConstraintViolationException) {
    const constraint = (error as unknown as { constraint?: string }).constraint;
    return new DuplicateKeyError(constraint, error);
  }

  if (
    error instanceof ConnectionException ||
    error instanceof DeadlockException ||
    error instanceof LockWaitTimeoutException
  ) {
    return new TransientInfrastructureError(error.message, error);
  }

  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_NODE_CODES.has(code))) {
    return new TransientInfrastructureError((error as Error).message, error);
  }

  // knex pool exhausted / database unreachable while acquiring a connection
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "KnexTimeoutError") {
    return new TransientInfrastructureError((error as Error).message, error);
  }

  return error;
};

export { translateDatabaseError };
