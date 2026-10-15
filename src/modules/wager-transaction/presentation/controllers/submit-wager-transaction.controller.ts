import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Output } from "ddd-tool-kit";
import type { Response } from "express";

import { SubmitWagerTransactionUseCase } from "../../domain/usecases/submit-wager-transaction/submit-wager-transaction.usecase";
import { MISSING_IDEMPOTENCY_KEY } from "../../domain/usecases/submit-wager-transaction/submit-wager-transaction.errors";
import { type WagerTransactionResultView } from "../../domain/mappers/wager-transaction-view.mapper";
import { FailureCode } from "../../../../shared/domain/failure-code";
import { WagerTransactionStatus } from "../../domain/aggregate/aggregate-root/wager-transaction.enums";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../../../../shared/presentation/http/api-error-responses";
import { ApiCorrelationIdHeader } from "../../../../shared/presentation/http/api-params";
import { CorrelationId } from "../../../../shared/presentation/http/correlation-id";
import { httpErrorFrom } from "../../../../shared/presentation/http/http-error";
import { statusFor } from "./transaction-result-status";
import { SubmitWagerTransactionRequestDto, WagerTransactionResultDto } from "./dtos/wager-transaction.dto";

const base = {
  providerId: "provider-a",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "4f1c2a9be07d3e58",
  roundId: "round-987",
  gameId: "fortune-chimp",
};

const result = (overrides: Partial<WagerTransactionResultView>) => ({
  transactionId: "9a7e0c3d51b2f846",
  status: WagerTransactionStatus.Processed,
  balance: { amount: "975.00", currency: "BRL" },
  failureCode: null,
  idempotentReplay: false,
  ...overrides,
});

@ApiTags("Wagering")
@Controller("wagering/transactions")
class SubmitWagerTransactionController {
  constructor(private readonly submitWagerTransaction: SubmitWagerTransactionUseCase) {}

  @Post()
  @ApiOperation({
    operationId: "submitWagerTransaction",
    summary: "Submit a wager transaction (BET, WIN, LOSS, REFUND, ROLLBACK)",
    description: [
      "Applies one operation of a game round to the wallet, atomically: transaction, balance, ledger entry and outbox event are committed together.",
      "",
      "**Idempotency.** `Idempotency-Key` is required and is the source of truth (recommended `{providerId}:{externalTransactionId}`). The same key with the same payload returns the **original result** (`idempotentReplay: true`, original balance). The same key with a different payload is `409 IDEMPOTENCY_CONFLICT` and nothing is stored.",
      "",
      "**Concurrency.** Operations on the same wallet are serialized by a row lock on that wallet; different wallets run in parallel.",
      "",
      "**References.** REFUND and ROLLBACK must reference a PROCESSED transaction of the same provider, player, wallet, currency and round, with the same amount, reverted at most once. If the reference has not arrived yet, the transaction is accepted as `PENDING_REFERENCE` (`202`) and retried in the background with exponential backoff.",
      "",
      "The same operation can be sent asynchronously through the SQS queue `wager-transactions.fifo` (same rules, same result).",
    ].join("\n"),
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Required. Identifies this operation forever. Reuse it only to retry the same request.",
    schema: { type: "string", maxLength: 256, example: "provider-a:transaction-123" },
  })
  @ApiCorrelationIdHeader()
  @ApiBody({
    type: SubmitWagerTransactionRequestDto,
    examples: {
      bet: {
        summary: "BET — debit",
        value: { ...base, externalTransactionId: "transaction-123", kind: "BET", money: { amount: "25.00", currency: "BRL" } },
      },
      win: {
        summary: "WIN — credit, optionally referencing the BET",
        value: {
          ...base,
          externalTransactionId: "transaction-124",
          kind: "WIN",
          money: { amount: "50.00", currency: "BRL" },
          referenceExternalTransactionId: "transaction-123",
        },
      },
      loss: {
        summary: "LOSS — records the result, no balance change",
        value: { ...base, externalTransactionId: "transaction-125", kind: "LOSS", money: { amount: "0.00", currency: "BRL" } },
      },
      refund: {
        summary: "REFUND — credits back a PROCESSED BET (same amount)",
        value: {
          ...base,
          externalTransactionId: "transaction-126",
          kind: "REFUND",
          money: { amount: "25.00", currency: "BRL" },
          referenceExternalTransactionId: "transaction-123",
        },
      },
      rollback: {
        summary: "ROLLBACK — inverts a PROCESSED BET, WIN or REFUND",
        value: {
          ...base,
          externalTransactionId: "transaction-127",
          kind: "ROLLBACK",
          money: { amount: "25.00", currency: "BRL" },
          referenceExternalTransactionId: "transaction-123",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Processed now.",
    type: WagerTransactionResultDto,
    examples: { processed: { summary: "BET processed", value: result({}) } },
  })
  @ApiResponse({
    status: 200,
    description: "Idempotent replay of a PROCESSED transaction: same body as the first time, with the balance of that moment.",
    type: WagerTransactionResultDto,
    examples: { replay: { summary: "Replay", value: result({ idempotentReplay: true }) } },
  })
  @ApiResponse({
    status: 202,
    description: "Accepted, waiting for the referenced transaction. Do not resend; query it later.",
    type: WagerTransactionResultDto,
    examples: {
      pending: {
        summary: "ROLLBACK before its BET",
        value: result({ status: WagerTransactionStatus.PendingReference, balance: null }),
      },
    },
  })
  @ApiErrorResponse(400, [FailureCode.InvalidPayload, FailureCode.InvalidAmount])
  @ApiErrorResponse(404, [FailureCode.WalletNotFound])
  @ApiErrorResponse(409, [FailureCode.IdempotencyConflict])
  @ApiResponse({
    status: 422,
    description: "Rejected by a business rule. The transaction is stored as REJECTED (auditable) and the body is the transaction result with `failureCode`. Resending does not change the outcome (a replay returns the same 422).",
    type: WagerTransactionResultDto,
    examples: {
      insufficientFunds: {
        summary: "INSUFFICIENT_FUNDS",
        value: result({ status: WagerTransactionStatus.Rejected, balance: { amount: "20.00", currency: "BRL" }, failureCode: FailureCode.InsufficientFunds }),
      },
      reversalWouldOverdraw: {
        summary: "REVERSAL_WOULD_OVERDRAW",
        value: result({ status: WagerTransactionStatus.Rejected, balance: { amount: "10.00", currency: "BRL" }, failureCode: FailureCode.ReversalWouldOverdraw }),
      },
      alreadyReversed: {
        summary: "REFERENCE_ALREADY_REVERSED",
        value: result({ status: WagerTransactionStatus.Rejected, failureCode: FailureCode.ReferenceAlreadyReversed }),
      },
      currencyMismatch: {
        summary: "CURRENCY_MISMATCH",
        value: result({ status: WagerTransactionStatus.Rejected, failureCode: FailureCode.CurrencyMismatch }),
      },
    },
  })
  @ApiInfrastructureErrors()
  async execute(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: SubmitWagerTransactionRequestDto,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WagerTransactionResultView> {
    if (!idempotencyKey?.trim()) throw httpErrorFrom(Output.fail(MISSING_IDEMPOTENCY_KEY));

    const output = await this.submitWagerTransaction.execute({ ...body, idempotencyKey, correlationId });
    if (output.isFailure) throw httpErrorFrom(output);

    const outcome = output.result as WagerTransactionResultView;
    response.status(statusFor(outcome));
    return outcome;
  }
}

export { SubmitWagerTransactionController };
