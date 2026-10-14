import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { GetWalletService } from "../../../application/use-cases/get-wallet/get-wallet.service";
import { type WalletView } from "../../../application/views/wallet.view";
import { FailureCode } from "../../../domain/shared/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../common/api-error-responses";
import { ApiWalletIdParam } from "../common/api-params";
import { httpErrorFrom } from "../common/http-error";
import { WalletResponseDto } from "../dtos/wallet.dto";

@ApiTags("Wallets")
@Controller("wallets")
class GetWalletController {
  constructor(private readonly getWallet: GetWalletService) {}

  @Get(":walletId")
  @ApiOperation({
    operationId: "getWallet",
    summary: "Get a wallet",
    description: "Returns the wallet with its **materialized** balance (read from the wallet row, not summed from the ledger) and current version. Shows the last committed state.",
  })
  @ApiWalletIdParam()
  @ApiResponse({
    status: 200,
    description: "Wallet found.",
    type: WalletResponseDto,
    examples: {
      afterBet: {
        summary: "After a 25.00 BET",
        value: {
          id: "4f1c2a9be07d3e58",
          playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
          balance: { amount: "975.00", currency: "BRL" },
          version: 2,
        },
      },
    },
  })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload], "walletId has an invalid format.")
  @ApiErrorResponse(404, [FailureCode.WalletNotFound])
  @ApiInfrastructureErrors()
  async execute(@Param("walletId") walletId: string): Promise<WalletView> {
    const output = await this.getWallet.execute({ walletId });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as WalletView;
  }
}

export { GetWalletController };
