import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output } from "ddd-tool-kit";

import { INVALID_ID } from "../../../../../shared/errors/common.errors";
import { UNIT_OF_WORK, type UnitOfWork } from "../../../../../shared/interfaces/unit-of-work.interface";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../interfaces/wager-transaction.repository";
import { failureFrom } from "../../../../../shared/errors/service-failure";
import { type WagerTransactionView, WagerTransactionViewMapper } from "../../mappers/wager-transaction-view.mapper";
import { TRANSACTION_NOT_FOUND } from "../../aggregate/aggregate-root/wager-transaction.errors";

@Injectable()
class GetWagerTransactionUseCase {
  private readonly logger = new Logger(GetWagerTransactionUseCase.name);
  private readonly mapper = new WagerTransactionViewMapper();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WAGER_TRANSACTION_REPOSITORY) private readonly transactions: WagerTransactionRepository,
  ) {}

  async execute(input: { transactionId: string }): Promise<Output<WagerTransactionView> | Output<IError>> {
    const createId = IdValueObject.init({ value: input.transactionId ?? "" });
    if (createId.isFailure) return Output.fail(INVALID_ID);

    try {
      const tx = await this.uow.transactional(() => this.transactions.findById(createId.result as IdValueObject), {
        readOnly: true,
      });
      if (!tx) return Output.fail(TRANSACTION_NOT_FOUND);
      return Output.success(this.mapper.toRightSide(tx));
    } catch (error) {
      return failureFrom(error, this.logger, { transactionId: input.transactionId });
    }
  }
}

export { GetWagerTransactionUseCase };
