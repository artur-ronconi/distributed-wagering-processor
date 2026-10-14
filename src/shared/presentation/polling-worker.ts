import { Logger } from "@nestjs/common";

/**
 * Minimal polling loop with graceful stop. `tick` returns how much work it did; a full batch
 * runs again immediately, otherwise the loop sleeps `intervalMs`.
 */
abstract class PollingWorker {
  protected abstract readonly logger: Logger;
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  protected abstract tick(): Promise<{ worked: number; full: boolean }>;
  protected abstract readonly intervalMs: number;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops after the current tick finishes (in-flight work is completed, not abandoned). */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let full = false;
      try {
        full = (await this.tick()).full;
      } catch (error) {
        this.logger.error({ err: (error as Error).message }, "worker tick failed");
      }
      if (this.running && !full) await this.sleep(this.intervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

export { PollingWorker };
