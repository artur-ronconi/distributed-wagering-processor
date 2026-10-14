import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output } from "ddd-tool-kit";

import { INVALID_ID } from "../../errors/common.errors";
import { UNIT_OF_WORK, type UnitOfWork } from "../../ports/unit-of-work.port";
import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from "../../ports/wager-transaction.repository";
import { failureFrom } from "../../services/service-failure";
import { type WagerTransactionView, WagerTransactionViewMapper } from "../../views/wager-transaction.view";
import { TRANSACTION_NOT_FOUND } from "../../../domain/wager-transaction/wager-transaction.errors";

@Injectable()
class GetWagerTransactionService {
  private readonly logger = new Logger(GetWagerTransactionService.name);
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

export { GetWagerTransactionService };
