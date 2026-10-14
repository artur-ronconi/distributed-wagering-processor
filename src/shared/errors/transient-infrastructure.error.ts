/**
 * A failure that may succeed if retried with the same input: database or SQS unreachable,
 * lock timeout, deadlock, serialization failure. Infrastructure adapters translate driver
 * errors into this class so the application never depends on driver error codes.
 */
class TransientInfrastructureError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "TransientInfrastructureError";
  }
}

export { TransientInfrastructureError };
