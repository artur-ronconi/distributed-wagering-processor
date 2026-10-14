import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { IdValueObject } from "ddd-tool-kit";

import { ConcurrencyConflictError } from "../../../../../shared/errors/concurrency-conflict.error";
import { type WalletRepository } from "../../../domain/interfaces/wallet.repository";
import { WalletAggregate } from "../../../domain/aggregate/aggregate-root/wallet.aggregate-root";
import { WalletLedgerEntryMapper } from "../../../domain/mappers/wallet-ledger-entry.mapper";
import { WalletMapper } from "../../../domain/mappers/wallet.mapper";
import { WalletLedgerEntrySchema } from "../schemas/wallet-ledger-entry.schema";
import { WalletSchema } from "../schemas/wallet.schema";

@Injectable()
class MikroOrmWalletRepository implements WalletRepository {
  private readonly walletMapper = new WalletMapper();
  private readonly entryMapper = new WalletLedgerEntryMapper();

  constructor(private readonly em: EntityManager) {}

  async findById(id: IdValueObject): Promise<WalletAggregate | null> {
    const row = await this.em.findOne(WalletSchema, { id: id.value }, { disableIdentityMap: true });
    return row ? this.walletMapper.toRightSide(row) : null;
  }

  async findByIdForUpdate(id: IdValueObject): Promise<WalletAggregate | null> {
    // SELECT ... FOR UPDATE: locks only this wallet's row until the transaction ends.
    const row = await this.em.findOne(
      WalletSchema,
      { id: id.value },
      { lockMode: LockMode.PESSIMISTIC_WRITE, disableIdentityMap: true },
    );
    return row ? this.walletMapper.toRightSide(row) : null;
  }

  async insert(wallet: WalletAggregate): Promise<void> {
    await this.em.insert(WalletSchema, this.walletMapper.toLeftSide(wallet));
    await this.appendNewEntries(wallet);
  }

  async save(wallet: WalletAggregate, expectedVersion: number): Promise<void> {
    const { id, balanceAmount, version, updatedAt } = this.walletMapper.toLeftSide(wallet);

    const affected = await this.em.nativeUpdate(
      WalletSchema,
      { id, version: expectedVersion },
      { balanceAmount, version, updatedAt },
    );
    if (affected === 0) throw new ConcurrencyConflictError("Wallet", id, expectedVersion);

    await this.appendNewEntries(wallet);
  }

  /** Child entities are saved through the root. Append-only: insert, never update or delete. */
  private async appendNewEntries(wallet: WalletAggregate): Promise<void> {
    const entries = wallet.pullNewLedgerEntries();
    if (entries.length === 0) return;

    await this.em.insertMany(
      WalletLedgerEntrySchema,
      entries.map((entry) => this.entryMapper.toLeftSide(entry)),
    );
  }
}

export { MikroOrmWalletRepository };
