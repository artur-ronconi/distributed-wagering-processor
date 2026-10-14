import { WagerTransactionAggregate } from "../../domain/wager-transaction/wager-transaction.aggregate-root";
import { EventContext, IntegrationEvent } from "./integration-event";
import { toWagerTransactionEventData, WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionPendingReferenceData extends WagerTransactionEventData {
  nextAttemptAt: string; // ISO-8601
}

class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionPendingReference(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        nextAttemptAt: tx.nextReferenceAttemptAt!.value.toISOString(), // always set by markPendingReference
      }),
    );
  }
}

export { WagerTransactionPendingReference, WagerTransactionPendingReferenceData };
