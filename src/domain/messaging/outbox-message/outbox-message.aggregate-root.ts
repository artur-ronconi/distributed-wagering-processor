import {
  Aggregate,
  DateValueObject,
  IdValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IOutboxEvent } from "./outbox-event.interface";
import { IOutboxMessageProps } from "./outbox-message.props";
import { INVALID_OUTBOX_MESSAGE, OutboxMessageAlreadyPublishedError } from "./outbox-message.errors";

class OutboxMessageAggregate extends Aggregate<IOutboxMessageProps> {
  private static readonly BASE_DELAY_MS = 1_000;
  private static readonly MAX_DELAY_MS = 5 * 60_000;

  private constructor(props: IOutboxMessageProps) {
    super(props);
  }

  get aggregateId() {
    return this.props.aggregateId;
  }

  get eventType() {
    return this.props.eventType;
  }

  get payload() {
    return this.props.payload;
  }

  get occurredAt() {
    return this.props.occurredAt;
  }

  get attempts() {
    return this.props.attempts;
  }

  get nextAttemptAt() {
    return this.props.nextAttemptAt;
  }

  get publishedAt() {
    return this.props.publishedAt;
  }

  isPending(): boolean {
    return this.props.publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this.props.nextAttemptAt.value.getTime() <= now.getTime();
  }

  markPublished(at: DateValueObject): void {
    if (!this.isPending()) throw new OutboxMessageAlreadyPublishedError(this.id.value);
    this.props.publishedAt = at;
    this.props.updatedAt = at;
  }

  /** Increments attempts and schedules the next try with exponential backoff (1s, 2s, 4s… max 5 min). */
  scheduleRetry(now: Date): void {
    this.props.attempts += 1;

    const exponent = Math.min(this.props.attempts - 1, 20);
    const delay = Math.min(
      OutboxMessageAggregate.BASE_DELAY_MS * 2 ** exponent,
      OutboxMessageAggregate.MAX_DELAY_MS,
    );

    this.props.nextAttemptAt = DateValueObject.init({
      value: new Date(now.getTime() + delay),
    }).result as DateValueObject;
    this.props.updatedAt = DateValueObject.init({ value: now }).result as DateValueObject;
  }

  protected sanitizeProps(): void {}

  protected isValidProps(): boolean {
    const valueObjects = ["occurredAt", "nextAttemptAt", ...this.defaultValueObjects];
    // `attempts` is not listed: verifyAllPropsExists rejects 0.
    const requiredProps = [...valueObjects, "aggregateId", "eventType", "payload"];

    return (
      verifyAllPropsExists(requiredProps, this) &&
      verifyAreValueObjects(valueObjects, this) &&
      Number.isInteger(this.props.attempts) &&
      this.props.attempts >= 0
    );
  }

  static enqueue(event: IOutboxEvent) {
    const createId = IdValueObject.init({ value: event.eventId });
    if (createId.isFailure) return Output.fail(INVALID_OUTBOX_MESSAGE);

    const occurredAt = DateValueObject.init({ value: event.occurredAt });
    if (occurredAt.isFailure) return Output.fail(INVALID_OUTBOX_MESSAGE);

    const message = new OutboxMessageAggregate({
      id: createId.result as IdValueObject,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: occurredAt.result as DateValueObject,
      attempts: 0,
      nextAttemptAt: occurredAt.result as DateValueObject,
    });

    const isInvalidProps = !message.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_OUTBOX_MESSAGE);

    return Output.success(message);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IOutboxMessageProps): OutboxMessageAggregate {
    return new OutboxMessageAggregate(props);
  }
}

export { OutboxMessageAggregate };
