import {
  Aggregate,
  DateValueObject,
  Output,
  verifyAllPropsExists,
  verifyAreValueObjects,
} from "ddd-tool-kit";

import { IInboxMessageProps, IReceiveInboxProps } from "./inbox-message.props";
import { INVALID_INBOX_MESSAGE, InboxMessageAlreadyProcessedError } from "./inbox-message.errors";

class InboxMessageAggregate extends Aggregate<IInboxMessageProps> {
  private constructor(props: IInboxMessageProps) {
    super(props);
  }

  get messageId() {
    return this.props.messageId;
  }

  get consumerName() {
    return this.props.consumerName;
  }

  get payloadHash() {
    return this.props.payloadHash;
  }

  get receivedAt() {
    return this.createdAt;
  }

  get processedAt() {
    return this.props.processedAt;
  }

  isProcessed(): boolean {
    return this.props.processedAt !== undefined;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.props.payloadHash === payloadHash;
  }

  markProcessed(at: DateValueObject): void {
    if (this.isProcessed()) {
      throw new InboxMessageAlreadyProcessedError(this.props.consumerName, this.props.messageId);
    }
    this.props.processedAt = at;
    this.props.updatedAt = at;
  }

  protected sanitizeProps(): void {
    this.props.messageId = this.props.messageId?.trim();
    this.props.consumerName = this.props.consumerName?.trim();
  }

  protected isValidProps(): boolean {
    const valueObjects = [...this.defaultValueObjects];
    const requiredProps = [...valueObjects, "messageId", "consumerName", "payloadHash"];

    return verifyAllPropsExists(requiredProps, this) && verifyAreValueObjects(valueObjects, this);
  }

  static receive(props: IReceiveInboxProps) {
    const message = new InboxMessageAggregate({ ...props });

    const isInvalidProps = !message.isValidProps();
    if (isInvalidProps) return Output.fail(INVALID_INBOX_MESSAGE);

    return Output.success(message);
  }

  /** Rebuilds persisted state. Does not revalidate. */
  static rehydrate(props: IInboxMessageProps): InboxMessageAggregate {
    return new InboxMessageAggregate(props);
  }
}

export { InboxMessageAggregate };
