/** An update conditioned on `version` affected no row: someone changed the aggregate first. */
class ConcurrencyConflictError extends Error {
  constructor(aggregate: string, id: string, expectedVersion: number) {
    super(`${aggregate} ${id} was changed concurrently (expected version ${expectedVersion}).`);
    this.name = "ConcurrencyConflictError";
  }
}

export { ConcurrencyConflictError };
