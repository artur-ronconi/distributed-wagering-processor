import { type MoneyProps } from "../../../wallet/domain/aggregate/value-objects/money/money.props";
import { WagerTransactionAggregate } from "../aggregate/aggregate-root/wager-transaction.aggregate-root";
import { type EventContext, IntegrationEvent } from "../../../messaging/domain/events/integration-event";
import { toWagerTransactionEventData, type WagerTransactionEventData } from "./wager-transaction.event-data";

interface WagerTransactionProcessedData extends WagerTransactionEventData {
  referenceTransactionId?: string;
  balance: MoneyProps; // observed balance after processing
}

class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(tx: WagerTransactionAggregate, ctx: EventContext) {
    return new WagerTransactionProcessed(
      IntegrationEvent.envelope(tx.id.value, ctx, {
        ...toWagerTransactionEventData(tx),
        referenceTransactionId: tx.referenceTransactionId?.value,
        balance: tx.observedBalance!.toJSON(), // always set by markProcessed
      }),
    );
  }
}

export { WagerTransactionProcessed, type WagerTransactionProcessedData };
