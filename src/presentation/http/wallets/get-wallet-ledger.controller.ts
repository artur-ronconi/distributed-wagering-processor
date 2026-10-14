import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import {
  GetWalletLedgerService,
  type IGetWalletLedgerServiceOutput,
} from "../../../application/use-cases/get-wallet-ledger/get-wallet-ledger.service";
import { FailureCode } from "../../../domain/shared/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../common/api-error-responses";
import { ApiWalletIdParam } from "../common/api-params";
import { httpErrorFrom } from "../common/http-error";
import { LedgerPageDto } from "../dtos/ledger.dto";

@ApiTags("Wallets")
@Controller("wallets")
class GetWalletLedgerController {
  constructor(private readonly getWalletLedger: GetWalletLedgerService) {}

  @Get(":walletId/ledger")
  @ApiOperation({
    operationId: "getWalletLedger",
    summary: "List the wallet ledger",
    description: [
      "The auditable statement of the wallet: one immutable entry per balance change, **newest first**.",
      "",
      "Keyset pagination with a **stable, opaque cursor**: pass `nextCursor` of the previous page as `cursor`. Entries appended between two requests never shift the pages (the ledger is append-only).",
    ].join("\n"),
  })
  @ApiWalletIdParam()
  @ApiQuery({ name: "limit", required: false, description: "Page size, 1 to 200", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } })
  @ApiQuery({ name: "cursor", required: false, description: "nextCursor from the previous page", schema: { type: "string" } })
  @ApiResponse({
    status: 200,
    description: "One page of the ledger, newest first.",
    type: LedgerPageDto,
    examples: {
      lastPage: {
        summary: "Last page",
        value: {
          items: [
            {
              id: "b81f04c7e2a9d365",
              transactionId: "9a7e0c3d51b2f846",
              direction: "DEBIT",
              money: { amount: "25.00", currency: "BRL" },
              balanceBefore: { amount: "1000.00", currency: "BRL" },
              balanceAfter: { amount: "975.00", currency: "BRL" },
              createdAt: "2026-07-29T15:00:00.000Z",
            },
            {
              id: "0e6d5c4b3a291f87",
              transactionId: "7c3b2a1f0e9d8c76",
              direction: "CREDIT",
              money: { amount: "1000.00", currency: "BRL" },
              balanceBefore: { amount: "0.00", currency: "BRL" },
              balanceAfter: { amount: "1000.00", currency: "BRL" },
              createdAt: "2026-07-29T14:59:00.000Z",
            },
          ],
          nextCursor: null,
        },
      },
    },
  })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload], "Invalid walletId, limit or cursor.")
  @ApiErrorResponse(404, [FailureCode.WalletNotFound])
  @ApiInfrastructureErrors()
  async execute(
    @Param("walletId") walletId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<IGetWalletLedgerServiceOutput> {
    const output = await this.getWalletLedger.execute({ walletId, limit, cursor });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as IGetWalletLedgerServiceOutput;
  }
}

export { GetWalletLedgerController };
