/** A unique constraint rejected a write. `constraint` is the database constraint name. */
class DuplicateKeyError extends Error {
  constructor(readonly constraint: string | undefined, override readonly cause?: unknown) {
    super(`Unique constraint violated: ${constraint ?? "unknown"}`);
    this.name = "DuplicateKeyError";
  }
}

export { DuplicateKeyError };
