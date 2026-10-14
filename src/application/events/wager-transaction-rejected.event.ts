import { FailureCode } from "../../domain/shared/failure-code";
import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { EventContext, IntegrationEvent } from "./integration-event";
import { toWagerTransactionEventData, WagerTransactionEventData } from "./wager-transaction.event-data";

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

export { WagerTransactionRejected, WagerTransactionRejectedData };
