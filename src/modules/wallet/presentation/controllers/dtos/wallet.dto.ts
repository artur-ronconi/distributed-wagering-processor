import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsObject, IsString, MaxLength, ValidateNested } from "class-validator";

import { MoneyDto, MoneyResponseDto } from "./money.dto";

class CreateWalletRequestDto {
  @ApiProperty({
    description: "Player identifier in the casino (external id, any format, 1 to 128 characters)",
    example: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  playerId!: string;

  @ApiProperty({
    description: 'Initial balance. Greater than zero creates an internal OPENING transaction and a CREDIT ledger entry. "0.00" is allowed.',
    type: MoneyDto,
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}

class WalletResponseDto {
  @ApiProperty({ description: "Wallet id (16 characters)", example: "4f1c2a9be07d3e58" })
  id!: string;

  @ApiProperty({ example: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1" })
  playerId!: string;

  @ApiProperty({ description: "Materialized balance (always equals the balance rebuilt from the ledger)", type: MoneyResponseDto })
  balance!: MoneyResponseDto;

  @ApiProperty({ description: "Starts at 1 and increases only when the balance changes", example: 1 })
  version!: number;
}

export { CreateWalletRequestDto, WalletResponseDto };
