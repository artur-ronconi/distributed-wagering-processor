import { describe, expect, it } from "bun:test";
import { DateValueObject, IdValueObject } from "ddd-tool-kit";

import { InboxMessageAggregate } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.aggregate-root";
import { InboxMessageAlreadyProcessedError } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/inbox-message/inbox-message.errors";
import { OutboxMessageAggregate } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.aggregate-root";
import { OutboxMessageAlreadyPublishedError } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-message.errors";
import { type IOutboxEvent } from "../../../src/modules/messaging/domain/aggregate/aggregate-root/outbox-message/outbox-event.interface";

describe("InboxMessageAggregate", () => {
  const receive = () =>
    InboxMessageAggregate.receive({ messageId: "msg-1", consumerName: "consumer", payloadHash: "h" })
      .result as InboxMessageAggregate;

  it("is received unprocessed, with receivedAt = createdAt", () => {
    const inbox = receive();

    expect(inbox.isProcessed()).toBe(false);
    expect(inbox.receivedAt).toBe(inbox.createdAt);
    expect(inbox.matchesPayload("h")).toBe(true);
    expect(inbox.matchesPayload("x")).toBe(false);
  });

  it("refuses empty fields", () => {
    expect(InboxMessageAggregate.receive({ messageId: " ", consumerName: "c", payloadHash: "h" }).isFailure).toBe(
      true,
    );
  });

  it("can be marked processed only once", () => {
    const inbox = receive();
    inbox.markProcessed(DateValueObject.getDefault());

    expect(inbox.isProcessed()).toBe(true);
    expect(() => inbox.markProcessed(DateValueObject.getDefault())).toThrow(InboxMessageAlreadyProcessedError);
  });
});

describe("OutboxMessageAggregate", () => {
  const event = (occurredAt = new Date("2026-07-29T15:00:00.000Z")): IOutboxEvent => ({
    eventId: IdValueObject.getDefault().value,
    eventType: "WalletBalanceChanged",
    aggregateId: IdValueObject.getDefault().value,
    occurredAt,
    toJSON: () => ({ hello: "world" }),
  });

  const enqueue = (occurredAt?: Date) => OutboxMessageAggregate.enqueue(event(occurredAt)).result as OutboxMessageAggregate;

  it("is enqueued pending and due at occurredAt", () => {
    const occurredAt = new Date("2026-07-29T15:00:00.000Z");
    const message = enqueue(occurredAt);

    expect(message.isPending()).toBe(true);
    expect(message.attempts).toBe(0);
    expect(message.payload).toEqual({ hello: "world" });
    expect(message.isDue(new Date(occurredAt.getTime() - 1))).toBe(false);
    expect(message.isDue(occurredAt)).toBe(true);
  });

  it("refuses an eventId that is not an IdValueObject", () => {
    expect(OutboxMessageAggregate.enqueue({ ...event(), eventId: "short" }).isFailure).toBe(true);
  });

  it("backs off exponentially up to 5 minutes", () => {
    const message = enqueue();
    const now = new Date(0);
    const delays: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      message.scheduleRetry(now);
      delays.push(message.nextAttemptAt.value.getTime() - now.getTime());
    }

    expect(delays.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(delays.at(-1)).toBe(300_000);
    expect(message.attempts).toBe(12);
  });

  it("can be published only once and is no longer due", () => {
    const message = enqueue();
    message.markPublished(DateValueObject.getDefault());

    expect(message.isPending()).toBe(false);
    expect(message.isDue(new Date())).toBe(false);
    expect(() => message.markPublished(DateValueObject.getDefault())).toThrow(OutboxMessageAlreadyPublishedError);
  });
});
