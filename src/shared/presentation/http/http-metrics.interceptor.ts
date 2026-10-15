import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { finalize, Observable } from "rxjs";

import { PrometheusMetrics } from "../../infrastructure/services/prometheus.metrics";

/** http_request_duration_seconds by route template (never the raw URL, to keep cardinality low). */
@Injectable()
class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: PrometheusMetrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const startedAt = performance.now();

    return next.handle().pipe(
      finalize(() => {
        const response = http.getResponse<Response>();
        const route = (request.route as { path?: string } | undefined)?.path ?? "unknown";
        this.metrics.httpRequests.observe(
          { method: request.method, route, status: String(response.statusCode) },
          (performance.now() - startedAt) / 1000,
        );
      }),
    );
  }
}

export { HttpMetricsInterceptor };
