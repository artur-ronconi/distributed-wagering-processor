import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { DependencyChecks } from "../../infrastructure/services/dependency-checks";
import { ShutdownState } from "../../infrastructure/services/shutdown-state";
import { Public } from "../http/public.decorator";
import { HealthLiveDto, HealthReadyDto } from "./dtos/health.dto";

@ApiTags("Health")
@Public()
@Controller("health")
class HealthController {
  constructor(
    private readonly checks: DependencyChecks,
    private readonly shutdown: ShutdownState,
  ) {}

  @Get("live")
  @ApiOperation({
    operationId: "healthLive",
    summary: "Liveness",
    description: "Is the process alive? No I/O and no dependency checks: a database outage must never make the orchestrator restart every instance. No authentication.",
  })
  @ApiResponse({ status: 200, description: "The process is alive.", type: HealthLiveDto, examples: { ok: { summary: "Alive", value: { status: "ok" } } } })
  live(): HealthLiveDto {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({
    operationId: "healthReady",
    summary: "Readiness",
    description: "Can this instance receive traffic? Checks PostgreSQL (`select 1`) and SQS (the input queue exists) with a 1s timeout each. Answers `503` as soon as the instance starts shutting down (SIGTERM). No authentication.",
  })
  @ApiResponse({
    status: 200,
    description: "PostgreSQL and SQS are reachable: ready to receive traffic.",
    type: HealthReadyDto,
    examples: {
      ok: {
        summary: "Ready",
        value: { status: "ok", checks: { postgres: { status: "up", latencyMs: 3 }, sqs: { status: "up", latencyMs: 12 } } },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "A dependency is down or the instance is shutting down.",
    type: HealthReadyDto,
    examples: {
      sqsDown: {
        summary: "SQS down",
        value: {
          status: "error",
          checks: { postgres: { status: "up", latencyMs: 3 }, sqs: { status: "down", error: "timeout after 1000ms" } },
        },
      },
      shuttingDown: {
        summary: "Shutting down",
        value: {
          status: "error",
          shuttingDown: true,
          checks: { postgres: { status: "up", latencyMs: 2 }, sqs: { status: "up", latencyMs: 9 } },
        },
      },
    },
  })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthReadyDto> {
    const [postgres, sqs] = await Promise.all([this.checks.postgres(), this.checks.sqsQueue()]);
    const shuttingDown = this.shutdown.isShuttingDown;
    const ok = !shuttingDown && postgres.status === "up" && sqs.status === "up";

    response.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? "ok" : "error", ...(shuttingDown ? { shuttingDown } : {}), checks: { postgres, sqs } };
  }
}

export { HealthController };
