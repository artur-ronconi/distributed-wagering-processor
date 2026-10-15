import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

import { FailureCode } from "../../domain/failure-code";

const RETRY_AFTER_SECONDS = "1";

/**
 * Every error leaves with the same body: { code, message, correlationId }.
 * 503 also carries Retry-After. Unexpected errors never leak details (they are logged instead).
 */
@Catch()
class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { id?: unknown }>();
    const correlationId = String(request.id ?? "");

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = FailureCode.InternalError;
    let message = "Unexpected error.";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      code = typeof payload.code === "string" ? payload.code : this.codeForStatus(status);
      message = this.messageFrom(payload.message, exception.message);
    } else {
      this.logger.error(
        { correlationId, err: exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception },
        "unhandled error",
      );
    }

    if (status === HttpStatus.SERVICE_UNAVAILABLE) response.setHeader("Retry-After", RETRY_AFTER_SECONDS);
    response.status(status).json({ code, message, correlationId });
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.NOT_FOUND) return "ROUTE_NOT_FOUND";
    if (status >= 400 && status < 500) return FailureCode.InvalidPayload;
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return FailureCode.TransientFailure;
    return FailureCode.InternalError;
  }

  private messageFrom(value: unknown, fallback: string): string {
    if (Array.isArray(value)) return value.join("; ");
    return typeof value === "string" ? value : fallback;
  }
}

export { AllExceptionsFilter };
