import { ApiProperty } from "@nestjs/swagger";

import { LedgerDirection } from "../../../domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { MoneyResponseDto } from "./money.dto";

class LedgerEntryDto {
  @ApiProperty({ example: "b81f04c7e2a9d365" })
  id!: string;

  @ApiProperty({ description: "Wager transaction that produced this entry", example: "9a7e0c3d51b2f846" })
  transactionId!: string;

  @ApiProperty({ enum: LedgerDirection, enumName: "LedgerDirection", example: LedgerDirection.Debit })
  direction!: LedgerDirection;

  @ApiProperty({ description: "Always positive; the direction says whether it adds or subtracts", type: MoneyResponseDto })
  money!: MoneyResponseDto;

  @ApiProperty({ type: MoneyResponseDto })
  balanceBefore!: MoneyResponseDto;

  @ApiProperty({ description: "balanceBefore ± money", type: MoneyResponseDto })
  balanceAfter!: MoneyResponseDto;

  @ApiProperty({ example: "2026-07-29T15:00:00.000Z" })
  createdAt!: string;
}

class LedgerPageDto {
  @ApiProperty({ type: [LedgerEntryDto], description: "Newest first" })
  items!: LedgerEntryDto[];

  @ApiProperty({
    description: "Opaque cursor for the next page; null when there are no more pages. Do not parse it.",
    type: String,
    nullable: true,
    example: null,
  })
  nextCursor!: string | null;
}

export { LedgerEntryDto, LedgerPageDto };
