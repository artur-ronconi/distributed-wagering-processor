import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { GetWagerTransactionService } from "../../../application/use-cases/get-wager-transaction/get-wager-transaction.service";
import { type WagerTransactionView } from "../../../application/views/wager-transaction.view";
import { FailureCode } from "../../../domain/shared/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../common/api-error-responses";
import { httpErrorFrom } from "../common/http-error";
import { WagerTransactionDto } from "../dtos/wager-transaction.dto";
import { transactionExamples } from "./wager-transaction.examples";

@ApiTags("Wagering")
@Controller("wagering/transactions")
class GetWagerTransactionController {
  constructor(private readonly getWagerTransaction: GetWagerTransactionService) {}

  @Get(":transactionId")
  @ApiOperation({
    operationId: "getWagerTransaction",
    summary: "Get a wager transaction by internal id",
    description: "Uses the `transactionId` returned on submission. Also finds internal OPENING transactions. A REJECTED transaction is still a successful query (`200`).",
  })
  @ApiParam({
    name: "transactionId",
    description: "Our internal id (16 characters)",
    example: "9a7e0c3d51b2f846",
    schema: { type: "string", minLength: 16, maxLength: 16 },
  })
  @ApiResponse({ status: 200, description: "Transaction found (in any status).", type: WagerTransactionDto, examples: transactionExamples })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload], "transactionId has an invalid format.")
  @ApiErrorResponse(404, [FailureCode.TransactionNotFound])
  @ApiInfrastructureErrors()
  async execute(@Param("transactionId") transactionId: string): Promise<WagerTransactionView> {
    const output = await this.getWagerTransaction.execute({ transactionId });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as WagerTransactionView;
  }
}

export { GetWagerTransactionController };
