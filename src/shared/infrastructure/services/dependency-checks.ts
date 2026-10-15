import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../../config/app-config";
import { QueueUrlResolver, SQS_CLIENT } from "./sqs.client";

interface DependencyCheck {
  status: "up" | "down";
  latencyMs?: number;
  error?: string;
}

const CHECK_TIMEOUT_MS = 1_000;

const timed = async (probe: () => Promise<unknown>): Promise<DependencyCheck> => {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    // Never expose connection strings or hosts: only the error message.
    return { status: "down", error: (error as Error).message.split("\n")[0]?.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
};

@Injectable()
class DependencyChecks {
  private readonly queues: QueueUrlResolver;

  constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "queues">,
  ) {
    this.queues = new QueueUrlResolver(sqs);
  }

  postgres(): Promise<DependencyCheck> {
    return timed(() => this.orm.em.fork().getConnection().execute("select 1"));
  }

  /** Confirms SQS answers and that the input queue exists. */
  sqsQueue(): Promise<DependencyCheck> {
    return timed(async () =>
      this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: await this.queues.resolve(this.config.queues.wagerTransactions),
          AttributeNames: ["QueueArn"],
        }),
      ),
    );
  }
}

export { DependencyChecks, type DependencyCheck };
