import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../../../config/app-config";
import { PublishOutboxUseCase } from "../../domain/usecases/publish-outbox/publish-outbox.usecase";
import { PollingWorker } from "../../../../shared/presentation/polling-worker";

@Injectable()
class OutboxPublisherProducer extends PollingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(OutboxPublisherProducer.name);
  protected readonly intervalMs: number;

  constructor(
    private readonly publishOutbox: PublishOutboxUseCase,
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

export { OutboxPublisherProducer };
