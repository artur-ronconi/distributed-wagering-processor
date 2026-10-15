import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { MoveWalletFundsUseCase } from "../../domain/usecases/move-wallet-funds/move-wallet-funds.usecase";
import { WagerTransactionKind } from "../../../wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { type WagerTransactionResultView } from "../../../wager-transaction/domain/mappers/wager-transaction-view.mapper";
import { statusFor } from "../../../wager-transaction/presentation/controllers/transaction-result-status";
import { CorrelationId } from "../../../../shared/presentation/http/correlation-id";
import { httpErrorFrom } from "../../../../shared/presentation/http/http-error";
import { WalletOperationRequestDto } from "./dtos/wallet-operation.dto";
import { ApiWalletOperation } from "./wallet-operation.docs";

@ApiTags("Wallets")
@Controller("wallets")
class WithdrawFromWalletController {
  constructor(private readonly moveWalletFunds: MoveWalletFundsUseCase) {}

  @Post(":walletId/withdrawals")
  @ApiWalletOperation("withdrawal")
  async execute(
    @Param("walletId") walletId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: WalletOperationRequestDto,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WagerTransactionResultView> {
    const output = await this.moveWalletFunds.execute({
      walletId,
      operation: WagerTransactionKind.Withdrawal,
      money: body.money,
      idempotencyKey,
      correlationId,
    });
    if (output.isFailure) throw httpErrorFrom(output);

    const result = output.result as WagerTransactionResultView;
    response.status(statusFor(result));
    return result;
  }
}

export { WithdrawFromWalletController };
