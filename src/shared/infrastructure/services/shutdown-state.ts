import { type BeforeApplicationShutdown, Injectable, Logger } from "@nestjs/common";

/** Set as soon as SIGTERM arrives, so /health/ready answers 503 while in-flight work finishes. */
@Injectable()
class ShutdownState implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownState.name);
  private shuttingDown = false;

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  beforeApplicationShutdown(signal?: string): void {
    this.shuttingDown = true;
    this.logger.log({ signal }, "shutting down: readiness now reports 503");
  }
}

export { ShutdownState };
