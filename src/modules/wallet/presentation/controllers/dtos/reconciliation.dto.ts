import { ApiProperty } from "@nestjs/swagger";

import { MoneyResponseDto } from "./money.dto";

class ReconciliationResponseDto {
  @ApiProperty({ example: "4f1c2a9be07d3e58" })
  walletId!: string;

  @ApiProperty({ description: "Materialized balance stored in the wallet", type: MoneyResponseDto })
  storedBalance!: MoneyResponseDto;

  @ApiProperty({ description: "Σ CREDIT − Σ DEBIT over the whole ledger", type: MoneyResponseDto })
  calculatedBalance!: MoneyResponseDto;

  @ApiProperty({ description: "stored − calculated (may be negative)", type: MoneyResponseDto })
  difference!: MoneyResponseDto;

  @ApiProperty({ description: "true when difference is zero. Divergences are logged and counted, never fixed", example: true })
  consistent!: boolean;

  @ApiProperty({ description: "Number of ledger entries summed", example: 42 })
  checkedEntries!: number;
}

export { ReconciliationResponseDto };
