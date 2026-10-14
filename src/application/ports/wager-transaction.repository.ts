import { IdValueObject } from "ddd-tool-kit";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";

const WAGER_TRANSACTION_REPOSITORY = Symbol("WAGER_TRANSACTION_REPOSITORY");

interface WagerTransactionRepository {
  findById(id: IdValueObject): Promise<WagerTransactionAggregate | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransactionAggregate | null>;
  findByExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionAggregate | null>;
  /** True when a PROCESSED REFUND or ROLLBACK already reverted `referenceTransactionId`. */
  isAlreadyReversed(referenceTransactionId: IdValueObject): Promise<boolean>;
  /** Must run inside uow.transactional. Due PENDING_REFERENCE rows, FOR UPDATE SKIP LOCKED. */
  lockDuePendingReferences(now: Date, limit: number): Promise<WagerTransactionAggregate[]>;
  insert(transaction: WagerTransactionAggregate): Promise<void>;
  /** Persists status, failure code, reference, observed balance and retry fields. */
  save(transaction: WagerTransactionAggregate): Promise<void>;
}

export { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository };
