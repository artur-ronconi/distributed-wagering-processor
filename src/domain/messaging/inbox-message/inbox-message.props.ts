import { DateValueObject, IBaseDomainAggregate } from "ddd-tool-kit";

/** createdAt (from Aggregate) is the moment the message was received. */
interface IInboxMessageProps extends IBaseDomainAggregate {
  messageId: string;    // SQS message id (external, any format)
  consumerName: string; // e.g. "wager-transactions-consumer"
  payloadHash: string;
  processedAt?: DateValueObject;
}

interface IReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
}

export { IInboxMessageProps, IReceiveInboxProps };
