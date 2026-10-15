import { FailureCode } from "../../../../shared/domain/failure-code";
import { WagerTransactionAggregate } from "../aggregate/aggregate-root/wager-transaction.aggregate-root";
import { type EventContext, IntegrationEvent } from "../../../messaging/domain/events/integration-event";
import { toWagerTransactionEventData, type WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionRejectedData extends WagerTransactionEventData {
  failureCode: FailureCode;
}

class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionRejected(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        failureCode: tx.failureCode!, // always set by reject
      }),
    );
  }
}

export { WagerTransactionRejected, type WagerTransactionRejectedData };
