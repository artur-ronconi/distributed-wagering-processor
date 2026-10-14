import { ApiProperty } from "@nestjs/swagger";

import { FailureCode } from "../../../domain/shared/failure-code";

class ErrorResponseDto {
  @ApiProperty({
    description: "Stable, machine-readable failure code. Decide whether to retry using this field, never the message.",
    enum: FailureCode,
    enumName: "FailureCode",
    example: FailureCode.WalletNotFound,
  })
  code!: FailureCode;

  @ApiProperty({ description: "Human-readable explanation", example: "Wallet does not exist." })
  message!: string;

  @ApiProperty({ description: "Same value as the X-Correlation-Id response header", example: "c0a8017e-3f2b-4c1d-9e8f-1a2b3c4d5e6f" })
  correlationId!: string;
}

export { ErrorResponseDto };
