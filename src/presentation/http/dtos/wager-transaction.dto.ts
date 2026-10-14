import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

import { FailureCode } from "../../../domain/shared/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../domain/wager-transaction/wager-transaction.enums";
import { MoneyDto, MoneyResponseDto } from "./money.dto";

const SUBMITTABLE_KINDS = Object.values(WagerTransactionKind).filter((kind) => kind !== WagerTransactionKind.Opening);

class SubmitWagerTransactionRequestDto {
  @ApiProperty({ description: "Game provider id", example: "provider-a", maxLength: 128 })
  @IsString()
  @MaxLength(128)
  providerId!: string;

  @ApiProperty({
    description: "The provider's own id for this operation. Unique per provider. Used to reference it later (REFUND/ROLLBACK) and to query it.",
    example: "transaction-123",
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  externalTransactionId!: string;

  @ApiProperty({ example: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1", maxLength: 128 })
  @IsString()
  @MaxLength(128)
  playerId!: string;

  @ApiProperty({ description: "Wallet id returned by POST /wallets (16 characters)", example: "4f1c2a9be07d3e58" })
  @IsString()
  walletId!: string;

  @ApiProperty({ example: "round-987", maxLength: 128 })
  @IsString()
  @MaxLength(128)
  roundId!: string;

  @ApiProperty({ example: "fortune-chimp", maxLength: 128 })
  @IsString()
  @MaxLength(128)
  gameId!: string;

  @ApiProperty({
    description: "BET debits, WIN credits, LOSS records without moving money, REFUND credits back a BET, ROLLBACK inverts a BET, WIN or REFUND. OPENING is internal and refused.",
    enum: SUBMITTABLE_KINDS,
    enumName: "SubmittableWagerTransactionKind",
    example: WagerTransactionKind.Bet,
  })
  @IsString()
  kind!: string;

  @ApiProperty({ description: "Positive amount (LOSS accepts 0.00). Must use the wallet currency.", type: MoneyDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ApiPropertyOptional({
    description: "Provider id (externalTransactionId) of the referenced transaction. Required for REFUND and ROLLBACK; optional for WIN (its BET).",
    example: "transaction-100",
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceExternalTransactionId?: string;
}

class WagerTransactionResultDto {
  @ApiProperty({ description: "Our internal id (16 characters)", example: "9a7e0c3d51b2f846" })
  transactionId!: string;

  @ApiProperty({ enum: WagerTransactionStatus, enumName: "WagerTransactionStatus", example: WagerTransactionStatus.Processed })
  status!: WagerTransactionStatus;

  @ApiProperty({
    description: "Wallet balance observed when the transaction was decided. A replay returns the balance of that moment, not the current one. null while PENDING_REFERENCE.",
    type: MoneyResponseDto,
    nullable: true,
  })
  balance!: MoneyResponseDto | null;

  @ApiProperty({
    description: "Set only when status is REJECTED",
    enum: FailureCode,
    enumName: "FailureCode",
    nullable: true,
    example: null,
  })
  failureCode!: FailureCode | null;

  @ApiProperty({ description: "true when this response repeats the result of an earlier identical request", example: false })
  idempotentReplay!: boolean;
}

class WagerTransactionDto {
  @ApiProperty({ example: "9a7e0c3d51b2f846" }) transactionId!: string;
  @ApiProperty({ example: "provider-a" }) providerId!: string;
  @ApiProperty({ example: "transaction-123" }) externalTransactionId!: string;
  @ApiProperty({ example: "4f1c2a9be07d3e58" }) walletId!: string;
  @ApiProperty({ example: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1" }) playerId!: string;
  @ApiProperty({ example: "round-987" }) roundId!: string;
  @ApiProperty({ example: "fortune-chimp" }) gameId!: string;

  @ApiProperty({ enum: WagerTransactionKind, enumName: "WagerTransactionKind", example: WagerTransactionKind.Bet })
  kind!: WagerTransactionKind;

  @ApiProperty({ type: MoneyResponseDto }) money!: MoneyResponseDto;

  @ApiProperty({ type: String, nullable: true, example: null })
  referenceExternalTransactionId!: string | null;

  @ApiProperty({ description: "Our id of the referenced transaction, once resolved", type: String, nullable: true, example: null })
  referenceTransactionId!: string | null;

  @ApiProperty({ enum: WagerTransactionStatus, enumName: "WagerTransactionStatus", example: WagerTransactionStatus.Processed })
  status!: WagerTransactionStatus;

  @ApiProperty({ enum: FailureCode, enumName: "FailureCode", nullable: true, example: null })
  failureCode!: FailureCode | null;

  @ApiProperty({ description: "Balance observed when decided; null while PENDING_REFERENCE", type: MoneyResponseDto, nullable: true })
  balance!: MoneyResponseDto | null;

  @ApiProperty({ type: String, nullable: true, example: "2026-07-29T15:00:00.120Z" })
  processedAt!: string | null;

  @ApiProperty({ example: "2026-07-29T15:00:00.100Z" })
  createdAt!: string;
}

export { SubmitWagerTransactionRequestDto, WagerTransactionResultDto, WagerTransactionDto, SUBMITTABLE_KINDS };
