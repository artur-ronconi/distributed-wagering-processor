import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output, throwFailOutput } from "ddd-tool-kit";

import { DuplicateKeyError } from "../../errors/duplicate-key.error";
import { canonicalize, sha256 } from "../../idempotency/canonical-payload-hash";
import { METRICS, type Metrics } from "../../ports/metrics.port";
import { UNIT_OF_WORK, type UnitOfWork } from "../../ports/unit-of-work.port";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../ports/wager-transaction.repository";
import { WALLET_REPOSITORY, type WalletRepository } from "../../ports/wallet.repository";
import { failureFrom } from "../../services/service-failure";
import { WagerTransactionProcessor } from "../../services/wager-transaction.processor";
import { type WalletView, WalletViewMapper } from "../../views/wallet.view";
import { MoneyValueObject } from "../../../domain/money/money.value-object";
import { WagerTransactionAggregate } from "../../../domain/wager-transaction/wager-transaction.aggregate-root";
import { WalletAggregate } from "../../../domain/wallet/wallet.aggregate-root";
import { INVALID_WALLET, WALLET_ALREADY_EXISTS } from "../../../domain/wallet/wallet.errors";
import { type ICreateWalletServiceInput } from "./create-wallet.input";

const MAX_PLAYER_ID_LENGTH = 128;

/**
 * Creates a wallet. A positive initial balance also creates the internal OPENING transaction and
 * its CREDIT ledger entry in the same SQL transaction. Uniqueness of player + currency is enforced
 * by the database, not by a "find then insert" check.
 */
@Injectable()
class CreateWalletService {
  private readonly logger = new Logger(CreateWalletService.name);
  private readonly mapper = new WalletViewMapper();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly processor: WagerTransactionProcessor,
  ) {}

  async execute(input: ICreateWalletServiceInput): Promise<Output<WalletView> | Output<IError>> {
    if (typeof input.playerId !== "string" || input.playerId.trim().length > MAX_PLAYER_ID_LENGTH) {
      return Output.fail(INVALID_WALLET);
    }

    const createMoney = MoneyValueObject.from(input.initialBalance);
    if (createMoney.isFailure) return throwFailOutput(createMoney);
    const initialBalance = createMoney.result as MoneyValueObject;

    const walletId = IdValueObject.getDefault();
    const opening = initialBalance.isZero()
      ? null
      : WagerTransactionAggregate.createOpening({
          walletId,
          playerId: input.playerId.trim(),
          money: initialBalance,
          payloadHash: sha256(canonicalize({ walletId: walletId.value, initialBalance: initialBalance.toJSON() })),
        });

    const openWallet = WalletAggregate.open({
      id: walletId,
      playerId: input.playerId,
      initialBalance,
      openingTransactionId: opening?.id ?? IdValueObject.getDefault(),
    });
    if (openWallet.isFailure) return throwFailOutput(openWallet);
    const wallet = openWallet.result as WalletAggregate;
    const openingEntry = wallet.newLedgerEntries[0] ?? null;

    try {
      await this.uow.transactional(async () => {
        await this.wallets.insert(wallet);
        if (opening) {
          await this.transactions.insert(opening);
          const ctx = { correlationId: input.correlationId, now: new Date() };
          await this.processor.enqueue(this.processor.eventsFor(opening, wallet, openingEntry, ctx));
        }
      });
    } catch (error) {
      if (error instanceof DuplicateKeyError && error.constraint === "wallets_player_currency_unique") {
        return Output.fail(WALLET_ALREADY_EXISTS);
      }
      return failureFrom(error, this.logger, { correlationId: input.correlationId });
    }

    if (opening) this.metrics.transactionDecided(opening.status, opening.kind);
    return Output.success(this.mapper.toRightSide(wallet));
  }
}

export { CreateWalletService };
