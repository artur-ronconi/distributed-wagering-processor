import { describe, expect, it } from "bun:test";
import { DateValueObject, IdValueObject } from "ddd-tool-kit";

import { WagerTransactionAggregate } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.aggregate-root";
import {
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.enums";
import { InvalidTransactionStateError } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.errors";
import { type ICreateWagerTransactionProps } from "../../../src/modules/wager-transaction/domain/aggregate/aggregate-root/wager-transaction.props";
import { LedgerDirection } from "../../../src/modules/wallet/domain/aggregate/entities/wallet-ledger-entry/wallet-ledger-entry.props";
import { type IDomainError } from "../../../src/shared/domain/domain-error";
import { FailureCode } from "../../../src/shared/domain/failure-code";
import { brl, money } from "../../support/money";

const walletId = IdValueObject.getDefault();

const props = (overrides: Partial<ICreateWagerTransactionProps> = {}): ICreateWagerTransactionProps => ({
  providerId: "provider-a",
  externalTransactionId: `tx-${Math.random()}`,
  idempotencyKey: `provider-a:${Math.random()}`,
  payloadHash: "hash",
  walletId,
  playerId: "player-1",
  roundId: "round-1",
  gameId: "fortune-chimp",
  kind: Kind.Bet,
  money: brl("25.00"),
  ...overrides,
});

const create = (overrides: Partial<ICreateWagerTransactionProps> = {}) => {
  const output = WagerTransactionAggregate.create(props(overrides));
  if (output.isFailure) throw new Error(JSON.stringify(output.result));
  return output.result as WagerTransactionAggregate;
};

const processed = (overrides: Partial<ICreateWagerTransactionProps> = {}) => {
  const tx = create(overrides);
  tx.markProcessed(undefined, DateValueObject.getDefault(), brl("100.00"));
  return tx;
};

const codeOf = (result: unknown): FailureCode => (result as IDomainError).code;
const now = () => DateValueObject.getDefault();

describe("WagerTransactionAggregate", () => {
  describe("create", () => {
    it("is born PENDING", () => {
      const tx = create();

      expect(tx.status).toBe(Status.Pending);
      expect(tx.isTerminal()).toBe(false);
      expect(tx.referenceAttempts).toBe(0);
    });

    it.each([Kind.Opening, Kind.Deposit, Kind.Withdrawal])("refuses the internal kind %s from a provider", (kind) => {
      const output = WagerTransactionAggregate.create(props({ kind }));
      expect(output.isFailure).toBe(true);
      expect(codeOf(output.result)).toBe(FailureCode.InvalidPayload);
      expect((output.result as IDomainError).message).toContain("internal");
    });

    it("refuses an unknown kind", () => {
      const output = WagerTransactionAggregate.create(props({ kind: "JACKPOT" as Kind }));
      expect(codeOf(output.result)).toBe(FailureCode.InvalidPayload);
    });

    it.each([Kind.Refund, Kind.Rollback])("%s requires a reference", (kind) => {
      const output = WagerTransactionAggregate.create(props({ kind }));

      expect(output.isFailure).toBe(true);
      expect(codeOf(output.result)).toBe(FailureCode.InvalidPayload);
    });

    it.each([Kind.Bet, Kind.Win, Kind.Refund, Kind.Rollback])("%s refuses a zero amount", (kind) => {
      const output = WagerTransactionAggregate.create(
        props({ kind, money: brl("0.00"), referenceExternalTransactionId: "ref" }),
      );
      expect(codeOf(output.result)).toBe(FailureCode.InvalidAmount);
    });

    it("LOSS accepts a zero amount", () => {
      expect(WagerTransactionAggregate.create(props({ kind: Kind.Loss, money: brl("0.00") })).isSuccess).toBe(true);
    });

    it("refuses empty identifiers", () => {
      expect(WagerTransactionAggregate.create(props({ roundId: "" })).isFailure).toBe(true);
    });
  });

  describe("transitions", () => {
    it("PENDING → PROCESSED stores the observed balance", () => {
      const tx = create();
      tx.markProcessed(undefined, now(), brl("75.00"));

      expect(tx.status).toBe(Status.Processed);
      expect(tx.observedBalance?.toString()).toBe("75.00");
      expect(tx.processedAt).toBeDefined();
      expect(tx.isTerminal()).toBe(true);
    });

    it("PENDING → REJECTED keeps the failure code", () => {
      const tx = create();
      tx.reject(FailureCode.InsufficientFunds, now(), brl("10.00"));

      expect(tx.status).toBe(Status.Rejected);
      expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    });

    it("PENDING → PENDING_REFERENCE → retry → PROCESSED", () => {
      const tx = create({ kind: Kind.Rollback, referenceExternalTransactionId: "bet-1" });
      tx.markPendingReference(now());
      tx.scheduleReferenceRetry(now());
      tx.scheduleReferenceRetry(now());

      expect(tx.status).toBe(Status.PendingReference);
      expect(tx.referenceAttempts).toBe(2);

      const referenceId = IdValueObject.getDefault();
      tx.markProcessed(referenceId, now(), brl("100.00"));

      expect(tx.status).toBe(Status.Processed);
      expect(tx.referenceTransactionId?.equals(referenceId)).toBe(true);
      expect(tx.nextReferenceAttemptAt).toBeUndefined();
    });

    it("PENDING_REFERENCE → REJECTED with REFERENCE_NOT_FOUND", () => {
      const tx = create({ kind: Kind.Refund, referenceExternalTransactionId: "bet-1" });
      tx.markPendingReference(now());
      tx.reject(FailureCode.ReferenceNotFound, now());

      expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
    });

    it("PENDING → FAILED", () => {
      const tx = create();
      tx.fail(FailureCode.InternalError, now());
      expect(tx.status).toBe(Status.Failed);
    });

    const terminalFactories: Array<[string, () => WagerTransactionAggregate]> = [
      ["PROCESSED", () => processed()],
      [
        "REJECTED",
        () => {
          const tx = create();
          tx.reject(FailureCode.InsufficientFunds, now());
          return tx;
        },
      ],
      [
        "FAILED",
        () => {
          const tx = create();
          tx.fail(FailureCode.InternalError, now());
          return tx;
        },
      ],
    ];

    for (const [name, factory] of terminalFactories) {
      it(`every transition from ${name} throws InvalidTransactionStateError`, () => {
        const tx = factory();
        expect(() => tx.markProcessed(undefined, now(), brl("1.00"))).toThrow(InvalidTransactionStateError);
        expect(() => tx.reject(FailureCode.InsufficientFunds, now())).toThrow(InvalidTransactionStateError);
        expect(() => tx.fail(FailureCode.InternalError, now())).toThrow(InvalidTransactionStateError);
        expect(() => tx.markPendingReference(now())).toThrow(InvalidTransactionStateError);
        expect(() => tx.scheduleReferenceRetry(now())).toThrow(InvalidTransactionStateError);
      });
    }

    it("cannot mark PENDING_REFERENCE twice nor retry from PENDING", () => {
      const tx = create({ kind: Kind.Refund, referenceExternalTransactionId: "bet-1" });
      expect(() => tx.scheduleReferenceRetry(now())).toThrow(InvalidTransactionStateError);
      tx.markPendingReference(now());
      expect(() => tx.markPendingReference(now())).toThrow(InvalidTransactionStateError);
    });
  });

  describe("domain queries", () => {
    it("affectsBalance is false only for LOSS", () => {
      expect(create({ kind: Kind.Loss }).affectsBalance()).toBe(false);
      for (const kind of [Kind.Bet, Kind.Win]) expect(create({ kind }).affectsBalance()).toBe(true);
    });

    it("requiresReference is true only for REFUND and ROLLBACK", () => {
      expect(create({ kind: Kind.Refund, referenceExternalTransactionId: "r" }).requiresReference()).toBe(true);
      expect(create({ kind: Kind.Rollback, referenceExternalTransactionId: "r" }).requiresReference()).toBe(true);
      expect(create({ kind: Kind.Bet }).requiresReference()).toBe(false);
      expect(create({ kind: Kind.Win, referenceExternalTransactionId: "r" }).requiresReference()).toBe(false);
    });

    it("matchesPayload distinguishes replay from conflict", () => {
      const tx = create({ payloadHash: "abc" });
      expect(tx.matchesPayload("abc")).toBe(true);
      expect(tx.matchesPayload("abd")).toBe(false);
    });

    it("ledgerDirectionFor", () => {
      expect(create({ kind: Kind.Bet }).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
      expect(create({ kind: Kind.Win }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(create({ kind: Kind.Refund, referenceExternalTransactionId: "r" }).ledgerDirectionFor()).toBe(
        LedgerDirection.Credit,
      );
      expect(() => create({ kind: Kind.Loss }).ledgerDirectionFor()).toThrow();

      const rollback = create({ kind: Kind.Rollback, referenceExternalTransactionId: "r" });
      expect(rollback.ledgerDirectionFor(create({ kind: Kind.Bet }))).toBe(LedgerDirection.Credit);
      expect(rollback.ledgerDirectionFor(create({ kind: Kind.Win }))).toBe(LedgerDirection.Debit);
      expect(
        rollback.ledgerDirectionFor(create({ kind: Kind.Refund, referenceExternalTransactionId: "r" })),
      ).toBe(LedgerDirection.Debit);
      expect(() => rollback.ledgerDirectionFor()).toThrow();
    });
  });

  describe("validateReference", () => {
    const reversal = (kind: Kind, overrides: Partial<ICreateWagerTransactionProps> = {}) =>
      create({ kind, referenceExternalTransactionId: "bet-1", ...overrides });

    it("accepts a PROCESSED BET of the same context and amount", () => {
      expect(reversal(Kind.Refund).validateReference(processed()).isSuccess).toBe(true);
      expect(reversal(Kind.Rollback).validateReference(processed()).isSuccess).toBe(true);
    });

    it("REFUND only references BET", () => {
      const output = reversal(Kind.Refund).validateReference(processed({ kind: Kind.Win }));
      expect(codeOf(output.result)).toBe(FailureCode.ReferenceKindNotAllowed);
    });

    it("ROLLBACK references BET, WIN and REFUND but not LOSS", () => {
      expect(reversal(Kind.Rollback).validateReference(processed({ kind: Kind.Win })).isSuccess).toBe(true);
      expect(
        reversal(Kind.Rollback)
          .validateReference(processed({ kind: Kind.Refund, referenceExternalTransactionId: "x" }))
          .isSuccess,
      ).toBe(true);
      expect(codeOf(reversal(Kind.Rollback).validateReference(processed({ kind: Kind.Loss })).result)).toBe(
        FailureCode.ReferenceKindNotAllowed,
      );
    });

    it("WIN may reference a BET with a different amount", () => {
      const win = create({ kind: Kind.Win, money: brl("50.00"), referenceExternalTransactionId: "bet-1" });
      expect(win.validateReference(processed()).isSuccess).toBe(true);
    });

    it("rejects a reference that is not PROCESSED", () => {
      const pendingBet = create();
      expect(codeOf(reversal(Kind.Refund).validateReference(pendingBet).result)).toBe(
        FailureCode.ReferenceNotProcessed,
      );
    });

    it.each<[string, Partial<ICreateWagerTransactionProps>]>([
      ["provider", { providerId: "provider-b" }],
      ["player", { playerId: "player-2" }],
      ["wallet", { walletId: IdValueObject.getDefault() }],
      ["round", { roundId: "round-2" }],
    ])("rejects a different %s", (_name, overrides) => {
      expect(codeOf(reversal(Kind.Refund).validateReference(processed(overrides)).result)).toBe(
        FailureCode.ReferenceMismatch,
      );
    });

    it("rejects a different currency", () => {
      const bet = processed({ money: money("25.00", "USD") });
      expect(codeOf(reversal(Kind.Refund).validateReference(bet).result)).toBe(FailureCode.ReferenceMismatch);
    });

    it("rejects a partial reversal", () => {
      const refund = reversal(Kind.Refund, { money: brl("10.00") });
      expect(codeOf(refund.validateReference(processed()).result)).toBe(FailureCode.ReferenceAmountMismatch);
    });
  });

  describe("createWalletOperation (deposit and withdrawal)", () => {
    const operation = (kind: Kind.Deposit | Kind.Withdrawal, amount = "50.00", key = "cashier-1") =>
      WagerTransactionAggregate.createWalletOperation({
        kind,
        walletId,
        playerId: "player-1",
        money: brl(amount),
        clientIdempotencyKey: key,
        payloadHash: "hash",
      });

    it("is born PENDING with internal provider fields and the client key scoped to the wallet", () => {
      const tx = operation(Kind.Deposit).result as WagerTransactionAggregate;

      expect(tx.kind).toBe(Kind.Deposit);
      expect(tx.status).toBe(Status.Pending);
      expect(tx.providerId).toBe("internal");
      expect(tx.idempotencyKey).toBe(`internal:${walletId.value}:cashier-1`);
      expect(tx.idempotencyKey).toBe(WagerTransactionAggregate.walletOperationKey(walletId, "cashier-1"));
      expect(tx.externalTransactionId).toBe(`deposit:${walletId.value}:cashier-1`);
      expect(tx.referenceExternalTransactionId).toBeUndefined();
      expect(tx.requiresReference()).toBe(false);
      expect(tx.affectsBalance()).toBe(true);
    });

    it("deposit credits and withdrawal debits", () => {
      expect((operation(Kind.Deposit).result as WagerTransactionAggregate).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect((operation(Kind.Withdrawal).result as WagerTransactionAggregate).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it.each([Kind.Deposit, Kind.Withdrawal] as const)("%s refuses a zero amount", (kind) => {
      const output = operation(kind, "0.00");
      expect(codeOf(output.result)).toBe(FailureCode.InvalidAmount);
    });

    it("refuses any other kind", () => {
      const output = WagerTransactionAggregate.createWalletOperation({
        kind: Kind.Bet as unknown as Kind.Deposit,
        walletId,
        playerId: "player-1",
        money: brl("50.00"),
        clientIdempotencyKey: "k",
        payloadHash: "hash",
      });
      expect(codeOf(output.result)).toBe(FailureCode.InvalidPayload);
    });

    it("follows the normal transitions (decided once, then terminal)", () => {
      const tx = operation(Kind.Withdrawal).result as WagerTransactionAggregate;
      tx.reject(FailureCode.InsufficientFunds, now(), brl("10.00"));

      expect(tx.status).toBe(Status.Rejected);
      expect(() => tx.markProcessed(undefined, now(), brl("10.00"))).toThrow(InvalidTransactionStateError);
    });
  });

  it("createOpening is born PROCESSED with internal provider fields", () => {
    const opening = WagerTransactionAggregate.createOpening({
      walletId,
      playerId: "player-1",
      money: brl("1000.00"),
      payloadHash: "hash",
    });

    expect(opening.kind).toBe(Kind.Opening);
    expect(opening.status).toBe(Status.Processed);
    expect(opening.providerId).toBe("internal");
    expect(opening.observedBalance?.toString()).toBe("1000.00");
  });
});
