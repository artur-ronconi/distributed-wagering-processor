import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

class HealthLiveDto {
  @ApiProperty({ example: "ok" })
  status!: "ok";
}

class DependencyCheckDto {
  @ApiProperty({ enum: ["up", "down"], example: "up" })
  status!: "up" | "down";

  @ApiPropertyOptional({ example: 3 })
  latencyMs?: number;

  @ApiPropertyOptional({ example: "timeout after 1000ms" })
  error?: string;
}

class HealthReadyChecksDto {
  @ApiProperty({ type: DependencyCheckDto }) postgres!: DependencyCheckDto;
  @ApiProperty({ type: DependencyCheckDto }) sqs!: DependencyCheckDto;
}

class HealthReadyDto {
  @ApiProperty({ enum: ["ok", "error"], example: "ok" })
  status!: "ok" | "error";

  @ApiPropertyOptional({ description: "Present while the instance is shutting down", example: false })
  shuttingDown?: boolean;

  @ApiProperty({ type: HealthReadyChecksDto })
  checks!: HealthReadyChecksDto;
}

export { HealthLiveDto, HealthReadyDto, DependencyCheckDto };
