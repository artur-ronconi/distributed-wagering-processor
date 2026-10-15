import { HttpStatus } from "ddd-tool-kit";
import { type IDomainError } from "../../../../../../shared/domain/domain-error";
import { FailureCode } from "../../../../../../shared/domain/failure-code";

const INVALID_INBOX_MESSAGE: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Inbox message requires messageId, consumerName and payloadHash.",
  statusCode: HttpStatus.BAD_REQUEST,
};

/** Programming error: the message was already marked as processed. */
class InboxMessageAlreadyProcessedError extends Error {
  constructor(consumerName: string, messageId: string) {
    super(`Inbox message ${consumerName}/${messageId} is already processed.`);
    this.name = "InboxMessageAlreadyProcessedError";
  }
}

export { INVALID_INBOX_MESSAGE, InboxMessageAlreadyProcessedError };
