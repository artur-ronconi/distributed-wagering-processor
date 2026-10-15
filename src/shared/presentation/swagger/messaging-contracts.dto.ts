import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { FailureCode } from "../../domain/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { LedgerDirection } from "../../../modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { MoneyResponseDto } from "../../../modules/wallet/presentation/controllers/dtos/money.dto";
import { SubmitWagerTransactionRequestDto } from "../../../modules/wager-transaction/presentation/controllers/dtos/wager-transaction.dto";

/** `data` of the SQS message: the HTTP body plus the idempotency key (no header in a queue). */
class WagerTransactionRequestedDataDto extends SubmitWagerTransactionRequestDto {
  @ApiProperty({ description: "Same role as the Idempotency-Key header", example: "provider-a:transaction-123" })
  idempotencyKey!: string;
}

/** Message sent by providers to wager-transactions.fifo (MessageGroupId = walletId recommended). */
class WagerTransactionRequestedMessageDto {
  @ApiProperty({ description: "Provider's message id: the inbox deduplication key", example: "msg-123" })
  messageId!: string;

  @ApiProperty({ enum: ["WagerTransactionRequested"], example: "WagerTransactionRequested" })
  type!: "WagerTransactionRequested";

  @ApiProperty({ example: "2026-07-29T15:00:00.000Z" })
  occurredAt!: string;

  @ApiProperty({ type: WagerTransactionRequestedDataDto })
  data!: WagerTransactionRequestedDataDto;
}

class IntegrationEventEnvelopeDto {
  @ApiProperty({ description: "Unique id: consumers deduplicate by it (delivery is at-least-once)", example: "c709aea9cc8dabc1" })
  eventId!: string;

  @ApiProperty({
    enum: ["WagerTransactionProcessed", "WagerTransactionRejected", "WalletBalanceChanged", "WagerTransactionPendingReference"],
    example: "WalletBalanceChanged",
  })
  eventType!: string;

  @ApiProperty({ description: "Wallet id or transaction id", example: "4f1c2a9be07d3e58" })
  aggregateId!: string;

  @ApiProperty({ example: "c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f" })
  correlationId!: string;

  @ApiPropertyOptional({ description: "What directly caused the event (e.g. the SQS messageId)", example: "msg-123" })
  causationId?: string;

  @ApiProperty({ example: "2026-07-29T15:00:00.000Z" })
  occurredAt!: string;

  @ApiProperty({ description: "Schema version of `data`", example: 1 })
  version!: number;
}

class WalletBalanceChangedDataDto {
  @ApiProperty({ example: "4f1c2a9be07d3e58" }) walletId!: string;
  @ApiProperty({ example: "9a7e0c3d51b2f846" }) transactionId!: string;
  @ApiProperty({ enum: LedgerDirection, enumName: "LedgerDirection" }) direction!: LedgerDirection;
  @ApiProperty({ type: MoneyResponseDto }) money!: MoneyResponseDto;
  @ApiProperty({ type: MoneyResponseDto }) balanceBefore!: MoneyResponseDto;
  @ApiProperty({ type: MoneyResponseDto }) balanceAfter!: MoneyResponseDto;
  @ApiProperty({ example: 2 }) walletVersion!: number;
}

class WagerTransactionEventDataDto {
  @ApiProperty({ example: "9a7e0c3d51b2f846" }) transactionId!: string;
  @ApiProperty({ example: "provider-a" }) providerId!: string;
  @ApiProperty({ example: "transaction-123" }) externalTransactionId!: string;
  @ApiProperty({ example: "4f1c2a9be07d3e58" }) walletId!: string;
  @ApiProperty({ example: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1" }) playerId!: string;
  @ApiProperty({ example: "round-987" }) roundId!: string;
  @ApiProperty({ example: "fortune-chimp" }) gameId!: string;
  @ApiProperty({ enum: WagerTransactionKind, enumName: "WagerTransactionKind" }) kind!: WagerTransactionKind;
  @ApiProperty({ enum: WagerTransactionStatus, enumName: "WagerTransactionStatus" }) status!: WagerTransactionStatus;
  @ApiProperty({ type: MoneyResponseDto }) money!: MoneyResponseDto;
  @ApiPropertyOptional({ example: "transaction-100" }) referenceExternalTransactionId?: string;
  @ApiPropertyOptional({ description: "WagerTransactionProcessed only", example: "7c3b2a1f0e9d8c76" }) referenceTransactionId?: string;
  @ApiPropertyOptional({ description: "WagerTransactionProcessed only: observed balance", type: MoneyResponseDto }) balance?: MoneyResponseDto;
  @ApiPropertyOptional({ description: "WagerTransactionRejected only", enum: FailureCode, enumName: "FailureCode" }) failureCode?: FailureCode;
  @ApiPropertyOptional({ description: "WagerTransactionPendingReference only", example: "2026-07-29T15:00:01.000Z" }) nextAttemptAt?: string;
}

const MESSAGING_MODELS = [
  WagerTransactionRequestedMessageDto,
  WagerTransactionRequestedDataDto,
  IntegrationEventEnvelopeDto,
  WalletBalanceChangedDataDto,
  WagerTransactionEventDataDto,
];

export { MESSAGING_MODELS };
