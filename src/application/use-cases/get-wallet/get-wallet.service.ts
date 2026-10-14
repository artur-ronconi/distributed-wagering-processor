import { Inject, Injectable, Logger } from "@nestjs/common";
import { type IError, IdValueObject, Output } from "ddd-tool-kit";

import { INVALID_ID } from "../../errors/common.errors";
import { UNIT_OF_WORK, type UnitOfWork } from "../../ports/unit-of-work.port";
import { WALLET_REPOSITORY, type WalletRepository } from "../../ports/wallet.repository";
import { failureFrom } from "../../services/service-failure";
import { type WalletView, WalletViewMapper } from "../../views/wallet.view";
import { WALLET_NOT_FOUND } from "../../../domain/wallet/wallet.errors";

@Injectable()
class GetWalletService {
  private readonly logger = new Logger(GetWalletService.name);
  private readonly mapper = new WalletViewMapper();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
  ) {}

  async execute(input: { walletId: string }): Promise<Output<WalletView> | Output<IError>> {
    const createId = IdValueObject.init({ value: input.walletId ?? "" });
    if (createId.isFailure) return Output.fail(INVALID_ID);

    try {
      const wallet = await this.uow.transactional(() => this.wallets.findById(createId.result as IdValueObject), {
        readOnly: true,
      });
      if (!wallet) return Output.fail(WALLET_NOT_FOUND);
      return Output.success(this.mapper.toRightSide(wallet));
    } catch (error) {
      return failureFrom(error, this.logger, { walletId: input.walletId });
    }
  }
}

export { GetWalletService };
