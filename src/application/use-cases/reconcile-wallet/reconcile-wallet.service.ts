import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output } from "ddd-tool-kit";

import { INVALID_ID } from "../../errors/common.errors";
import { LEDGER_RECONCILIATION_QUERY, type LedgerReconciliationQuery } from "../../ports/ledger-reconciliation.query";
import { METRICS, type Metrics } from "../../ports/metrics.port";
import { UNIT_OF_WORK, type UnitOfWork } from "../../ports/unit-of-work.port";
import { WALLET_REPOSITORY, type WalletRepository } from "../../ports/wallet.repository";
import { failureFrom } from "../../services/service-failure";
import { type MoneyProps } from "../../../domain/money/money.props";
import { MoneyValueObject } from "../../../domain/money/money.value-object";
import { WALLET_NOT_FOUND } from "../../../domain/wallet/wallet.errors";

interface IReconcileWalletServiceOutput {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

/** Signed decimal string from SQL ("-25.00" is possible when the ledger is corrupted). */
const signedMoney = (amount: string, currency: string): MoneyValueObject => {
  const negative = amount.startsWith("-");
  const value = MoneyValueObject.from({ amount: negative ? amount.slice(1) : amount, currency })
    .result as MoneyValueObject;
  return negative ? value.negate() : value;
};

/**
 * Compares the materialized balance with the balance rebuilt from the ledger. Both are read from the
 * same snapshot (REPEATABLE READ, read only), so concurrent bets never cause a false divergence.
 * Divergences are logged and counted, never fixed silently.
 */
@Injectable()
class ReconcileWalletService {
  private readonly logger = new Logger(ReconcileWalletService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(LEDGER_RECONCILIATION_QUERY) private readonly ledger: LedgerReconciliationQuery,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async execute(input: {
    walletId: string;
    correlationId: string;
  }): Promise<Output<IReconcileWalletServiceOutput> | Output<IError>> {
    const createId = IdValueObject.init({ value: input.walletId ?? "" });
    if (createId.isFailure) return Output.fail(INVALID_ID);

    try {
      const snapshot = await this.uow.transactional(
        async () => {
          const wallet = await this.wallets.findById(createId.result as IdValueObject);
          if (!wallet) return null;
          return { wallet, totals: await this.ledger.totals(wallet.id.value) };
        },
        { isolation: "REPEATABLE READ", readOnly: true },
      );
      if (!snapshot) return Output.fail(WALLET_NOT_FOUND);

      const { wallet, totals } = snapshot;
      const stored = wallet.balance;
      const calculated = signedMoney(totals.calculated, wallet.currency);
      const difference = stored.subtract(calculated);
      const consistent = difference.isZero();

      if (!consistent) {
        this.metrics.reconciliationMismatch(wallet.currency);
        this.logger.error(
          {
            correlationId: input.correlationId,
            walletId: wallet.id.value,
            storedBalance: stored.toString(),
            calculatedBalance: calculated.toString(),
            difference: difference.toString(),
          },
          "wallet balance diverges from ledger",
        );
      }

      return Output.success({
        walletId: wallet.id.value,
        storedBalance: stored.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: difference.toJSON(),
        consistent,
        checkedEntries: totals.checkedEntries,
      });
    } catch (error) {
      return failureFrom(error, this.logger, { walletId: input.walletId, correlationId: input.correlationId });
    }
  }
}

export { ReconcileWalletService, type IReconcileWalletServiceOutput };
