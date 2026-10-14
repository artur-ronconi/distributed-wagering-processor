import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreateWalletService } from "../../../application/use-cases/create-wallet/create-wallet.service";
import { type WalletView } from "../../../application/views/wallet.view";
import { FailureCode } from "../../../domain/shared/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../common/api-error-responses";
import { ApiCorrelationIdHeader } from "../common/api-params";
import { CorrelationId } from "../common/correlation-id";
import { httpErrorFrom } from "../common/http-error";
import { CreateWalletRequestDto, WalletResponseDto } from "../dtos/wallet.dto";

@ApiTags("Wallets")
@Controller("wallets")
class CreateWalletController {
  constructor(private readonly createWallet: CreateWalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: "createWallet",
    summary: "Create a wallet",
    description: [
      "Creates the wallet of a player in one currency. At most **one wallet per `playerId` + `currency`** (enforced by the database).",
      "",
      "When `initialBalance` is greater than zero, an internal **OPENING** transaction and its **CREDIT** ledger entry are created in the same SQL transaction, so the reconciliation is consistent from the first second.",
      "",
      "This route has no Idempotency-Key: resending after a timeout answers `409 WALLET_ALREADY_EXISTS`.",
    ].join("\n"),
  })
  @ApiCorrelationIdHeader()
  @ApiBody({
    type: CreateWalletRequestDto,
    examples: {
      withBalance: {
        summary: "With initial balance",
        value: { playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1", initialBalance: { amount: "1000.00", currency: "BRL" } },
      },
      empty: {
        summary: "Empty wallet (no OPENING)",
        value: { playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1", initialBalance: { amount: "0.00", currency: "BRL" } },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Wallet created (version 1)",
    type: WalletResponseDto,
    examples: {
      created: {
        summary: "Created",
        value: {
          id: "4f1c2a9be07d3e58",
          playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
          balance: { amount: "1000.00", currency: "BRL" },
          version: 1,
        },
      },
    },
  })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload])
  @ApiErrorResponse(409, [FailureCode.WalletAlreadyExists], "A wallet already exists for this playerId + currency.")
  @ApiInfrastructureErrors()
  async execute(@Body() body: CreateWalletRequestDto, @CorrelationId() correlationId: string): Promise<WalletView> {
    const output = await this.createWallet.execute({ ...body, correlationId });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as WalletView;
  }
}

export { CreateWalletController };
