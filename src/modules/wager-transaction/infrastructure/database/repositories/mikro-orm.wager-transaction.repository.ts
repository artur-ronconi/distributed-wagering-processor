import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { IdValueObject } from "ddd-tool-kit";

import { type WagerTransactionRepository } from "../../../domain/services/wager-transaction.repository";
import { WagerTransactionAggregate } from "../../../domain/aggregate/aggregate-root/wager-transaction.aggregate-root";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/aggregate/aggregate-root/wager-transaction.enums";
import { WagerTransactionMapper } from "../mappers/wager-transaction.mapper";
import { WagerTransactionSchema } from "../schemas/wager-transaction.schema";

@Injectable()
class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  private readonly mapper = new WagerTransactionMapper();

  constructor(private readonly em: EntityManager) {}

  async findById(id: IdValueObject): Promise<WagerTransactionAggregate | null> {
    return this.findOne({ id: id.value });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransactionAggregate | null> {
    return this.findOne({ idempotencyKey });
  }

  async findByExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionAggregate | null> {
    return this.findOne({ providerId, externalTransactionId });
  }

  async isAlreadyReversed(referenceTransactionId: IdValueObject): Promise<boolean> {
    const count = await this.em.count(WagerTransactionSchema, {
      referenceTransactionId: referenceTransactionId.value,
      kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
      status: WagerTransactionStatus.Processed,
    });
    return count > 0;
  }

  async lockDuePendingReferences(now: Date, limit: number): Promise<WagerTransactionAggregate[]> {
    // FOR UPDATE SKIP LOCKED: concurrent workers on other instances take different rows.
    const rows = await this.em.find(
      WagerTransactionSchema,
      { status: WagerTransactionStatus.PendingReference, nextReferenceAttemptAt: { $lte: now } },
      {
        orderBy: { nextReferenceAttemptAt: "asc" },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        disableIdentityMap: true,
      },
    );
    return rows.map((row) => this.mapper.toRightSide(row));
  }

  async insert(transaction: WagerTransactionAggregate): Promise<void> {
    await this.em.insert(WagerTransactionSchema, this.mapper.toLeftSide(transaction));
  }

  async save(transaction: WagerTransactionAggregate): Promise<void> {
    const row = this.mapper.toLeftSide(transaction);

    await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: row.id },
      {
        status: row.status,
        referenceTransactionId: row.referenceTransactionId,
        failureCode: row.failureCode,
        observedBalanceAmount: row.observedBalanceAmount,
        processedAt: row.processedAt,
        referenceAttempts: row.referenceAttempts,
        nextReferenceAttemptAt: row.nextReferenceAttemptAt,
        updatedAt: row.updatedAt,
      },
    );
  }

  private async findOne(where: Record<string, unknown>): Promise<WagerTransactionAggregate | null> {
    const row = await this.em.findOne(WagerTransactionSchema, where, { disableIdentityMap: true });
    return row ? this.mapper.toRightSide(row) : null;
  }
}

export { MikroOrmWagerTransactionRepository };
