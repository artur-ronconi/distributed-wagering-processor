import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const CORRELATION_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * pino-http request id generator: reuses a valid X-Correlation-Id from the caller or creates one,
 * and echoes it in the response. Every log line of the request carries it as `req.id`.
 */
const correlationIdFor = (req: IncomingMessage, res: ServerResponse): string => {
  const incoming = req.headers[CORRELATION_HEADER];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = value && VALID_CORRELATION_ID.test(value) ? value : randomUUID();
  res.setHeader("X-Correlation-Id", id);
  return id;
};

/** Controller parameter: the request's correlation id. */
const CorrelationId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ id?: unknown }>();
  return typeof req.id === "string" ? req.id : String(req.id ?? randomUUID());
});

export { CorrelationId, correlationIdFor, CORRELATION_HEADER };
