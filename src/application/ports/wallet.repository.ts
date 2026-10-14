import { IdValueObject } from "ddd-tool-kit";
import { WalletAggregate } from "../../domain/wallet/wallet.aggregate-root";

const WALLET_REPOSITORY = Symbol("WALLET_REPOSITORY");

interface WalletRepository {
  findById(id: IdValueObject): Promise<WalletAggregate | null>;
  /** Must run inside uow.transactional. Locks only this wallet's row until commit. */
  findByIdForUpdate(id: IdValueObject): Promise<WalletAggregate | null>;
  /** Inserts the wallet and its new ledger entries. */
  insert(wallet: WalletAggregate): Promise<void>;
  /** Updates the wallet conditioned on expectedVersion and appends its new ledger entries. */
  save(wallet: WalletAggregate, expectedVersion: number): Promise<void>;
}

export { WALLET_REPOSITORY, type WalletRepository };
