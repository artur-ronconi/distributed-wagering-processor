import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";

import { PrometheusMetrics } from "../../infrastructure/services/prometheus.metrics";
import { Public } from "../http/public.decorator";

/** Prometheus scrape endpoint (operational, kept out of the public API docs). */
@ApiExcludeController()
@Public()
@Controller("metrics")
class MetricsController {
  constructor(private readonly metrics: PrometheusMetrics) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  async scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

export { MetricsController };
