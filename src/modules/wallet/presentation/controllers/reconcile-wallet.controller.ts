import { Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import {
  type IReconcileWalletServiceOutput,
  ReconcileWalletUseCase,
} from "../../domain/usecases/reconcile-wallet/reconcile-wallet.usecase";
import { FailureCode } from "../../../../shared/domain/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../../../../shared/presentation/http/api-error-responses";
import { ApiCorrelationIdHeader, ApiWalletIdParam } from "../../../../shared/presentation/http/api-params";
import { CorrelationId } from "../../../../shared/presentation/http/correlation-id";
import { httpErrorFrom } from "../../../../shared/presentation/http/http-error";
import { ReconciliationResponseDto } from "./dtos/reconciliation.dto";

@ApiTags("Wallets")
@Controller("wallets")
class ReconcileWalletController {
  constructor(private readonly reconcileWallet: ReconcileWalletUseCase) {}

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: "reconcileWallet",
    summary: "Reconcile the wallet with its ledger",
    description: [
      "Compares the stored balance with **Σ CREDIT − Σ DEBIT** of the ledger. Both values come from the same database snapshot (`REPEATABLE READ`), so bets running at the same time never cause a false divergence.",
      "",
      "Always `200`: a divergence is a **result**, not a request error. It is logged, counted in `wagering_reconciliation_mismatches_total` and returned with `consistent: false`. It is **never fixed automatically**.",
    ].join("\n"),
  })
  @ApiWalletIdParam()
  @ApiCorrelationIdHeader()
  @ApiResponse({
    status: 200,
    description: "Reconciliation result, consistent or not.",
    type: ReconciliationResponseDto,
    examples: {
      consistent: {
        summary: "Consistent",
        value: {
          walletId: "4f1c2a9be07d3e58",
          storedBalance: { amount: "975.00", currency: "BRL" },
          calculatedBalance: { amount: "975.00", currency: "BRL" },
          difference: { amount: "0.00", currency: "BRL" },
          consistent: true,
          checkedEntries: 42,
        },
      },
      divergent: {
        summary: "Divergent (logged and counted)",
        value: {
          walletId: "4f1c2a9be07d3e58",
          storedBalance: { amount: "975.00", currency: "BRL" },
          calculatedBalance: { amount: "1000.00", currency: "BRL" },
          difference: { amount: "-25.00", currency: "BRL" },
          consistent: false,
          checkedEntries: 41,
        },
      },
    },
  })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload], "walletId has an invalid format.")
  @ApiErrorResponse(404, [FailureCode.WalletNotFound])
  @ApiInfrastructureErrors()
  async execute(
    @Param("walletId") walletId: string,
    @CorrelationId() correlationId: string,
  ): Promise<IReconcileWalletServiceOutput> {
    const output = await this.reconcileWallet.execute({ walletId, correlationId });
    if (output.isFailure) throw httpErrorFrom(output);
    return output.result as IReconcileWalletServiceOutput;
  }
}

export { ReconcileWalletController };
