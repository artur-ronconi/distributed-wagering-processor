import { Inject, Injectable, Logger } from "@nestjs/common";
import { HttpStatus, type IError, Output } from "ddd-tool-kit";

import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/services/unit-of-work.service";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../services/wager-transaction.repository";
import { failureFrom } from "../../../../../shared/errors/service-failure";
import { type WagerTransactionView, WagerTransactionViewMapper } from "../../mappers/wager-transaction-view.mapper";
import { type IDomainError } from "../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../shared/domain/failure-code";
import { TRANSACTION_NOT_FOUND } from "../../aggregate/aggregate-root/wager-transaction.errors";

const INVALID_EXTERNAL_ID: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "providerId and externalTransactionId must have 1 to 128 characters.",
  statusCode: HttpStatus.BAD_REQUEST,
};

const isValid = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 128;

@Injectable()
class GetProviderWagerTransactionUseCase {
  private readonly logger = new Logger(GetProviderWagerTransactionUseCase.name);
  private readonly mapper = new WagerTransactionViewMapper();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
  ) {}

  async execute(input: {
    providerId: string;
    externalTransactionId: string;
  }): Promise<Output<WagerTransactionView> | Output<IError>> {
    if (!isValid(input.providerId) || !isValid(input.externalTransactionId)) return Output.fail(INVALID_EXTERNAL_ID);

    try {
      const tx = await this.uow.transactional(
        () => this.transactions.findByExternalId(input.providerId, input.externalTransactionId),
        { readOnly: true },
      );
      if (!tx) return Output.fail(TRANSACTION_NOT_FOUND);
      return Output.success(this.mapper.toRightSide(tx));
    } catch (error) {
      return failureFrom(error, this.logger, { providerId: input.providerId });
    }
  }
}

export { GetProviderWagerTransactionUseCase };
