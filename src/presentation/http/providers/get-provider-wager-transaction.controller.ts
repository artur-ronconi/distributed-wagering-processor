import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { GetProviderWagerTransactionService } from "../../../application/use-cases/get-provider-wager-transaction/get-provider-wager-transaction.service";
import { type WagerTransactionView } from "../../../application/views/wager-transaction.view";
import { FailureCode } from "../../../domain/shared/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../common/api-error-responses";
import { httpErrorFrom } from "../common/http-error";
import { WagerTransactionDto } from "../dtos/wager-transaction.dto";
import { transactionExamples } from "../wagering/wager-transaction.examples";

@ApiTags("Providers")
@Controller("providers")
class GetProviderWagerTransactionController {
  constructor(private readonly getProviderWagerTransaction: GetProviderWagerTransactionService) {}

  @Get(":providerId/wagering/transactions/:externalTransactionId")
  @ApiOperation({
    operationId: "getProviderWagerTransaction",
    summary: "Get a wager transaction by the provider's id",
    description: [
      "Looks a transaction up by `(providerId, externalTransactionId)`, unique in the database. Natural way for a provider to follow an operation sent through the **queue**, where there is no synchronous answer:",
      "",
      "- `404` → not processed yet (or never arrived): try again later;",
      "- `200` with `PROCESSED`/`REJECTED` → final result;",
      "- `200` with `PENDING_REFERENCE` → waiting for the reference: try again later.",
    ].join("\n"),
  })
  @ApiParam({ name: "providerId", example: "provider-a", schema: { type: "string", maxLength: 128 } })
  @ApiParam({
    name: "externalTransactionId",
    description: "The provider's own id of the operation (URL-encode special characters)",
    example: "transaction-123",
    schema: { type: "string", maxLength: 128 },
  })
  @ApiResponse({ status: 200, description: "Transaction found (in any status).", type: WagerTransactionDto, examples: transactionExamples })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload], "Empty or too long parameter.")
  @ApiErrorResponse(404, [FailureCode.TransactionNotFound])
  @ApiInfrastructureErrors()
  async execute(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    const output = await this.getProviderWagerTransaction.execute({ providerId, externalTransactionId });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as WagerTransactionView;
  }
}

export { GetProviderWagerTransactionController };
