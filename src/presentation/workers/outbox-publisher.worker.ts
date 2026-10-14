import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/app-config";
import { PublishOutboxService } from "../../application/use-cases/publish-outbox/publish-outbox.service";
import { PollingWorker } from "./polling-worker";

@Injectable()
class OutboxPublisherWorker extends PollingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(OutboxPublisherWorker.name);
  protected readonly intervalMs: number;

  constructor(
    private readonly publishOutbox: PublishOutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
    this.intervalMs = config.outboxPublisher.intervalMs;
  }

  onApplicationBootstrap(): void {
    if (this.config.run.outboxPublisher) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  protected async tick(): Promise<{ worked: number; full: boolean }> {
    const published = await this.publishOutbox.execute();
    return { worked: published, full: published >= this.config.outboxPublisher.batchSize };
  }
}

export { OutboxPublisherWorker };
