import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

/** Money in contracts: decimal string with exactly 2 places, never a number. */
class MoneyDto {
  @ApiProperty({
    description: 'Decimal string with exactly 2 decimal places. Never a JSON number. Negative values are rejected on input.',
    example: "25.00",
    pattern: "^(0|[1-9]\\d{0,16})\\.\\d{2}$",
  })
  @IsString()
  amount!: string;

  @ApiProperty({ description: "ISO-4217 currency code", example: "BRL", pattern: "^[A-Z]{3}$" })
  @IsString()
  currency!: string;
}

/** Same shape for responses; amounts may be negative only in reconciliation differences. */
class MoneyResponseDto {
  @ApiProperty({ description: "Decimal string with exactly 2 decimal places", example: "975.00" })
  amount!: string;

  @ApiProperty({ description: "ISO-4217 currency code", example: "BRL" })
  currency!: string;
}

export { MoneyDto, MoneyResponseDto };
