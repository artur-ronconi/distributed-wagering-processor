import { Inject, Injectable, Logger } from "@nestjs/common";
import { HttpStatus, type IError, IdValueObject, Output } from "ddd-tool-kit";

import { INVALID_ID } from "../../errors/common.errors";
import { decodeLedgerCursor, encodeLedgerCursor } from "../../pagination/ledger-cursor";
import { UNIT_OF_WORK, type UnitOfWork } from "../../ports/unit-of-work.port";
import { type LedgerCursor, type LedgerEntryView, WALLET_LEDGER_QUERY, type WalletLedgerQuery } from "../../ports/wallet-ledger.query";
import { WALLET_REPOSITORY, type WalletRepository } from "../../ports/wallet.repository";
import { failureFrom } from "../../services/service-failure";
import { type IDomainError } from "../../../domain/shared/domain-error";
import { FailureCode } from "../../../domain/shared/failure-code";
import { WALLET_NOT_FOUND } from "../../../domain/wallet/wallet.errors";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const INVALID_PAGINATION: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: `limit must be an integer from 1 to ${MAX_LIMIT}, and cursor must be a value returned as nextCursor.`,
  statusCode: HttpStatus.BAD_REQUEST,
};

interface LedgerPageEntry extends Omit<LedgerEntryView, "createdAt"> {
  createdAt: string;
}

interface IGetWalletLedgerServiceOutput {
  items: LedgerPageEntry[];
  nextCursor: string | null;
}

/** Read side: keyset pagination over the append-only ledger, newest first. */
@Injectable()
class GetWalletLedgerService {
  private readonly logger = new Logger(GetWalletLedgerService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WALLET_LEDGER_QUERY) private readonly ledger: WalletLedgerQuery,
  ) {}

  async execute(input: {
    walletId: string;
    cursor?: string;
    limit?: string | number;
  }): Promise<Output<IGetWalletLedgerServiceOutput> | Output<IError>> {
    const createId = IdValueObject.init({ value: input.walletId ?? "" });
    if (createId.isFailure) return Output.fail(INVALID_ID);

    const limit = input.limit === undefined || input.limit === "" ? DEFAULT_LIMIT : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return Output.fail(INVALID_PAGINATION);

    let after: LedgerCursor | null = null;
    if (input.cursor) {
      after = decodeLedgerCursor(input.cursor);
      if (!after) return Output.fail(INVALID_PAGINATION);
    }

    try {
      const page = await this.uow.transactional(
        async () => {
          const wallet = await this.wallets.findById(createId.result as IdValueObject);
          if (!wallet) return null;
          return this.ledger.page(wallet.id.value, after, limit + 1);
        },
        { readOnly: true },
      );
      if (!page) return Output.fail(WALLET_NOT_FOUND);

      const items = page.slice(0, limit);
      const last = items.at(-1);
      const nextCursor = page.length > limit && last ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null;

      return Output.success({
        items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
        nextCursor,
      });
    } catch (error) {
      return failureFrom(error, this.logger, { walletId: input.walletId });
    }
  }
}

export { GetWalletLedgerService, type IGetWalletLedgerServiceOutput, type LedgerPageEntry };
