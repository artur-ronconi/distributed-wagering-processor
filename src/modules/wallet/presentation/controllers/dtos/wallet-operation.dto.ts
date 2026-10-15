import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsObject, ValidateNested } from "class-validator";

import { MoneyDto } from "./money.dto";

/** Body of POST /wallets/:walletId/deposits and /withdrawals. */
class WalletOperationRequestDto {
  @ApiProperty({
    description: "Positive amount in the wallet currency, with exactly 2 decimal places.",
    type: MoneyDto,
    example: { amount: "50.00", currency: "BRL" },
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;
}

export { WalletOperationRequestDto };
