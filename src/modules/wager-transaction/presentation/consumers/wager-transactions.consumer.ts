import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../../../config/app-config";
import { sha256 } from "../../../../shared/utils/canonical-hash";
import { METRICS, type Metrics } from "../../../../shared/interfaces/metrics.interface";
import { SubmitWagerTransactionUseCase } from "../../domain/usecases/submit-wager-transaction/submit-wager-transaction.usecase";
import { type ISubmitWagerMessageOutput } from "../../domain/usecases/submit-wager-transaction/submit-wager-transaction.output";
import { InboxMessageAggregate } from "../../../messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root";
import { type IDomainError } from "../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../shared/domain/failure-code";
import { type MoneyProps } from "../../../wallet/domain/aggregate/value-objects/money/money.props";
import { QueueUrlResolver, SQS_CLIENT } from "../../../../shared/infrastructure/services/sqs.client";

const CONSUMER_NAME = "wager-transactions-consumer";
const MAX_VISIBILITY_BACKOFF_SECONDS = 300;

/** Failures that will never succeed on retry and were not persisted: keep them auditable in the DLQ. */
const PERMANENT_FAILURES = new Set<FailureCode>([
  FailureCode.InvalidPayload,
  FailureCode.InvalidAmount,
  FailureCode.IdempotencyConflict,
  FailureCode.WalletNotFound,
]);

interface WagerTransactionRequested {
  messageId?: string;
  type: "WagerTransactionRequested";
  occurredAt?: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
  };
}

type Verdict = "ack" | "retry" | "dlq";

/**
 * Consumes wager-transactions.fifo with the SAME use case as POST /wagering/transactions.
 * - inbox (consumerName, messageId) registered in the same SQL transaction as the money change;
 * - ack (DeleteMessage) only after the commit;
 * - business results (processed, rejected, pending, replay, duplicate) → ack;
 * - permanent errors that persisted nothing → DLQ explicitly;
 * - transient errors → no ack, visibility backoff; the redrive policy moves it to the DLQ after maxReceiveCount;
 * - SIGTERM: lets the current long poll end (it is never aborted: the server would still hand a
 *   message to the abandoned request and hide it for the visibility timeout), finishes the in-flight
 *   message and returns the visibility of the received ones not started.
 */
@Injectable()
class WagerTransactionsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WagerTransactionsConsumer.name);
  private readonly queues: QueueUrlResolver;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly submitWagerTransaction: SubmitWagerTransactionUseCase,
  ) {
    this.queues = new QueueUrlResolver(sqs);
  }

  onApplicationBootstrap(): void {
    if (this.config.run.sqsConsumer) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.poll();
  }

  /** Waits at most WaitTimeSeconds plus the message being processed. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      let messages: Message[] = [];
      try {
        const queueUrl = await this.queues.resolve(this.config.queues.wagerTransactions);
        const received = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: this.config.sqsConsumer.maxMessages,
            WaitTimeSeconds: this.config.sqsConsumer.waitTimeSeconds,
            VisibilityTimeout: this.config.sqsConsumer.visibilityTimeoutSeconds,
            MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
          }),
        );
        messages = received.Messages ?? [];
      } catch (error) {
        if (!this.running) break;
        this.logger.warn({ err: (error as Error).message }, "receive failed, retrying");
        await Bun.sleep(1_000);
        continue;
      }

      // Sequential: preserves FIFO order inside a message group.
      for (const [index, message] of messages.entries()) {
        if (!this.running) {
          await this.releaseUnstarted(messages.slice(index));
          break;
        }
        await this.handle(message);
      }
    }
  }

  /** Processes one message and applies the verdict (ack / retry / DLQ). Exposed for tests. */
  async handle(message: Message): Promise<Verdict> {
    const startedAt = performance.now();
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? "1");
    const parsed = this.parse(message);

    let verdict: Verdict;
    let reason: string = "ok";
    if (!parsed) {
      verdict = "dlq";
      reason = "MALFORMED_MESSAGE";
    } else {
      const output = await this.submitWagerTransaction.executeFromMessage(
        {
          ...parsed.body.data,
          correlationId: parsed.messageId,
          causationId: parsed.messageId,
        },
        parsed.inbox,
      );
      if (output.isSuccess) {
        verdict = "ack";
        const result = output.result as ISubmitWagerMessageOutput;
        reason = result.duplicateMessage ? "DUPLICATE_MESSAGE" : result.result.status;
      } else {
        const code = (output.result as IDomainError).code;
        reason = code ?? FailureCode.InternalError;
        verdict = code && PERMANENT_FAILURES.has(code) ? "dlq" : "retry";
      }
    }

    try {
      if (verdict === "ack") await this.ack(message);
      if (verdict === "dlq") await this.sendToDlq(message, reason);
      if (verdict === "retry") await this.backoff(message, receiveCount);
    } catch (error) {
      // Not acked: SQS redelivers after the visibility timeout and the inbox absorbs the duplicate.
      this.logger.warn({ messageId: message.MessageId, err: (error as Error).message }, "could not settle message");
    }

    this.metrics.observeProcessing("sqs", (performance.now() - startedAt) / 1000);
    this.logger.log(
      {
        messageId: parsed?.messageId ?? message.MessageId,
        sqsMessageId: message.MessageId,
        walletId: parsed?.body.data.walletId,
        providerId: parsed?.body.data.providerId,
        receiveCount,
        verdict,
        reason,
      },
      "wager message handled",
    );
    return verdict;
  }

  private parse(
    message: Message,
  ): { body: WagerTransactionRequested; messageId: string; inbox: InboxMessageAggregate } | null {
    try {
      const body = JSON.parse(message.Body ?? "") as WagerTransactionRequested;
      if (body?.type !== "WagerTransactionRequested" || typeof body.data !== "object" || body.data === null) {
        return null;
      }
      // The provider's messageId (stable across re-publications) is the deduplication key.
      const messageId = typeof body.messageId === "string" && body.messageId ? body.messageId : message.MessageId;
      if (!messageId) return null;

      const createInbox = InboxMessageAggregate.receive({
        messageId,
        consumerName: CONSUMER_NAME,
        payloadHash: sha256(message.Body ?? ""),
      });
      if (createInbox.isFailure) return null;
      return { body, messageId, inbox: createInbox.result as InboxMessageAggregate };
    } catch {
      return null;
    }
  }

  private async ack(message: Message): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: await this.queues.resolve(this.config.queues.wagerTransactions),
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private async sendToDlq(message: Message, reason: string): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: await this.queues.resolve(this.config.queues.wagerTransactionsDlq),
        MessageBody: message.Body ?? "",
        MessageGroupId: message.Attributes?.MessageGroupId ?? "dlq",
        MessageDeduplicationId: message.MessageId,
        MessageAttributes: { failureCode: { DataType: "String", StringValue: reason } },
      }),
    );
    await this.ack(message);
    this.metrics.sentToDlq(reason);
  }

  /** Exponential visibility backoff: 2s, 4s, 8s… up to 5 min. */
  private async backoff(message: Message, receiveCount: number): Promise<void> {
    this.metrics.retry("sqs_message");
    const seconds = Math.min(2 ** receiveCount, MAX_VISIBILITY_BACKOFF_SECONDS);
    await this.sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: await this.queues.resolve(this.config.queues.wagerTransactions),
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }

  /** On shutdown: make received-but-not-started messages visible again right away. */
  private async releaseUnstarted(messages: Message[]): Promise<void> {
    const queueUrl = await this.queues.resolve(this.config.queues.wagerTransactions);
    await Promise.allSettled(
      messages.map((message) =>
        this.sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        ),
      ),
    );
  }
}

export { WagerTransactionsConsumer, CONSUMER_NAME };
