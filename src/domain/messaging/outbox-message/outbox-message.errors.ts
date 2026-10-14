import { HttpStatus } from "ddd-tool-kit";
import { IDomainError } from "../../shared/domain-error";
import { FailureCode } from "../../shared/failure-code";

// Should never reach a provider: events are built by our own code.
const INVALID_OUTBOX_MESSAGE: IDomainError = {
  code: FailureCode.InvalidPayload,
  message: "Outbox message requires a valid eventId, eventType, aggregateId and payload.",
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Programming error: the message was already published. */
class OutboxMessageAlreadyPublishedError extends Error {
  constructor(id: string) {
    super(`Outbox message ${id} is already published.`);
    this.name = "OutboxMessageAlreadyPublishedError";
  }
}

export { INVALID_OUTBOX_MESSAGE, OutboxMessageAlreadyPublishedError };
