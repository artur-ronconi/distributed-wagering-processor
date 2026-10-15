import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, type ApiResponseExamples } from "@nestjs/swagger";

import { FailureCode } from "../../../../shared/domain/failure-code";
import { ApiErrorResponse, ApiInfrastructureErrors } from "../../../../shared/presentation/http/api-error-responses";
import { ApiCorrelationIdHeader, ApiWalletIdParam } from "../../../../shared/presentation/http/api-params";
import { WagerTransactionStatus } from "../../../wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { WagerTransactionResultDto } from "../../../wager-transaction/presentation/controllers/dtos/wager-transaction.dto";
import { WalletOperationRequestDto } from "./dtos/wallet-operation.dto";

type Operation = "deposit" | "withdrawal";

const result = (overrides: Record<string, unknown>) => ({
  transactionId: "7c2d9e0b4a1f3e65",
  status: WagerTransactionStatus.Processed,
  balance: { amount: "1050.00", currency: "BRL" },
  failureCode: null,
  idempotentReplay: false,
  ...overrides,
});

const TEXT: Record<Operation, { operationId: string; summary: string; effect: string; balanceAfter: string; key: string }> = {
  deposit: {
    operationId: "depositToWallet",
    summary: "Deposit money into a wallet",
    effect: "Adds `money.amount` to the wallet balance and records a **CREDIT** ledger entry.",
    balanceAfter: "1050.00",
    key: "cashier:deposit-8841",
  },
  withdrawal: {
    operationId: "withdrawFromWallet",
    summary: "Withdraw money from a wallet",
    effect:
      "Takes `money.amount` from the wallet balance and records a **DEBIT** ledger entry. The balance never goes below zero: a withdrawal larger than the balance is **REJECTED** with `INSUFFICIENT_FUNDS` (`422`), stored for auditing, and the balance does not change.",
    balanceAfter: "950.00",
    key: "cashier:withdrawal-8842",
  },
};

/** Full OpenAPI documentation of the deposit and withdrawal routes. */
const ApiWalletOperation = (operation: Operation) => {
  const text = TEXT[operation];
  const kind = operation === "deposit" ? "DEPOSIT" : "WITHDRAWAL";

  const rejected: Record<string, ApiResponseExamples> =
    operation === "withdrawal"
      ? {
          insufficientFunds: {
            summary: "INSUFFICIENT_FUNDS",
            value: result({ status: WagerTransactionStatus.Rejected, balance: { amount: "30.00", currency: "BRL" }, failureCode: FailureCode.InsufficientFunds }),
          },
          currencyMismatch: {
            summary: "CURRENCY_MISMATCH",
            value: result({ status: WagerTransactionStatus.Rejected, balance: { amount: "1000.00", currency: "BRL" }, failureCode: FailureCode.CurrencyMismatch }),
          },
        }
      : {
          currencyMismatch: {
            summary: "CURRENCY_MISMATCH",
            value: result({ status: WagerTransactionStatus.Rejected, balance: { amount: "1000.00", currency: "BRL" }, failureCode: FailureCode.CurrencyMismatch }),
          },
        };

  return applyDecorators(
    ApiOperation({
      operationId: text.operationId,
      summary: text.summary,
      description: [
        text.effect,
        "",
        `Stored as an internal transaction of kind \`${kind}\` (provider \`internal\`), decided by the same rules as the wager transactions: the wallet row is locked, balance, ledger entry and outbox events (\`WagerTransactionProcessed\` + \`WalletBalanceChanged\`, or \`WagerTransactionRejected\`) are committed together, and \`POST /wallets/{walletId}/reconciliation\` keeps matching.`,
        "",
        "**Idempotency.** `Idempotency-Key` is required and scoped to the wallet. The same key with the same body returns the **original result** (`200`, `idempotentReplay: true`, balance of that moment) without moving money again. The same key with a different body (other amount, or a deposit key reused for a withdrawal) is `409 IDEMPOTENCY_CONFLICT`.",
        "",
        "Not part of the challenge statement: an extension documented in ARCHITECTURE.md. Providers cannot create these operations through `POST /wagering/transactions`.",
      ].join("\n"),
    }),
    ApiWalletIdParam(),
    ApiHeader({
      name: "Idempotency-Key",
      required: true,
      description: "Required. Identifies this operation on this wallet forever. Reuse it only to retry the same request.",
      schema: { type: "string", maxLength: 256, example: text.key },
    }),
    ApiCorrelationIdHeader(),
    ApiBody({
      type: WalletOperationRequestDto,
      examples: {
        [operation]: { summary: `${kind} of 50.00 BRL`, value: { money: { amount: "50.00", currency: "BRL" } } },
      },
    }),
    ApiResponse({
      status: 201,
      description: "Processed now: the balance already reflects the operation.",
      type: WagerTransactionResultDto,
      examples: { processed: { summary: `${kind} processed`, value: result({ balance: { amount: text.balanceAfter, currency: "BRL" } }) } },
    }),
    ApiResponse({
      status: 200,
      description: "Idempotent replay: same body as the first time, with the balance of that moment. Nothing moved again.",
      type: WagerTransactionResultDto,
      examples: {
        replay: { summary: "Replay", value: result({ balance: { amount: text.balanceAfter, currency: "BRL" }, idempotentReplay: true }) },
      },
    }),
    ApiErrorResponse(400, [FailureCode.InvalidPayload, FailureCode.InvalidAmount]),
    ApiErrorResponse(404, [FailureCode.WalletNotFound]),
    ApiErrorResponse(409, [FailureCode.IdempotencyConflict]),
    ApiResponse({
      status: 422,
      description: "Rejected by a business rule. Stored as REJECTED (auditable); the balance does not change. The body is the result with `failureCode`; resending returns the same 422.",
      type: WagerTransactionResultDto,
      examples: rejected,
    }),
    ApiInfrastructureErrors(),
  );
};

export { ApiWalletOperation };
