const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");

interface TransactionOptions {
  isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE"; // default: READ COMMITTED
  readOnly?: boolean;
}

/**
 * Transaction boundary owned by the use case. Repositories called inside `work` share the
 * same database transaction. Driver errors are translated into TransientInfrastructureError,
 * DuplicateKeyError or rethrown.
 */
interface UnitOfWork {
  transactional<T>(work: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}

export { UNIT_OF_WORK, UnitOfWork, TransactionOptions };
