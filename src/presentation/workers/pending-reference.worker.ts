import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/app-config";
import { ResolvePendingReferencesService } from "../../application/use-cases/resolve-pending-references/resolve-pending-references.service";
import { PollingWorker } from "./polling-worker";

@Injectable()
class PendingReferenceWorker extends PollingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(PendingReferenceWorker.name);
  protected readonly intervalMs: number;

  constructor(
    private readonly resolvePendingReferences: ResolvePendingReferencesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
    this.intervalMs = config.pendingReference.intervalMs;
  }

  onApplicationBootstrap(): void {
    if (this.config.run.pendingReferenceWorker) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  protected async tick(): Promise<{ worked: number; full: boolean }> {
    const handled = await this.resolvePendingReferences.execute();
    return { worked: handled, full: handled >= this.config.pendingReference.batchSize };
  }
}

export { PendingReferenceWorker };
