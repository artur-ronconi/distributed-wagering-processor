import type { Row, Snapshot } from "../api";
import { F, S } from "./catalog";
import { byEmitOrder, invariantNote, money } from "./format";
import type { Extra, Sink } from "./sink";
import type { StepDef } from "./types";

const REFERENCE_CODES = [
  "REFERENCE_KIND_NOT_ALLOWED",
  "REFERENCE_NOT_PROCESSED",
  "REFERENCE_MISMATCH",
  "REFERENCE_AMOUNT_MISMATCH",
];
const FUNDS_CODES = ["INSUFFICIENT_FUNDS", "REVERSAL_WOULD_OVERDRAW"];

type Origin = "usecase" | "worker";

interface DecisionInput {
  track?: string;
  origin: Origin;
  /** The transaction row after it was decided. */
  tx: Row;
  /** The referenced transaction, when there is one. */
  reference: Row | null;
  /** Wallet as seen right after taking its lock. */
  walletAtLock: Row | null;
  /** Ledger entries written for this transaction (0 or 1). */
  ledger: Row[];
}

type Decision = "processed" | "rejected" | "reference-missing";

const inferDirection = (kind: string, reference: Row | null) => {
  if (kind === "BET") return "DEBIT";
  if (kind === "ROLLBACK") return reference?.kind === "BET" ? "CREDIT" : "DEBIT";
  return "CREDIT";
};

/**
 * Steps of processor.decide(), following the order of its checks. Which branch was taken comes from
 * the persisted result (status + failureCode + ledger entry).
 */
const emitDecision = (sink: Sink, d: DecisionInput): Decision => {
  const add = (def: StepDef, extra: Extra = {}) => sink.add(def, { track: d.track, ...extra });
  const { tx } = d;
  const code = (tx.failureCode as string | null) ?? null;
  const amount = money(tx.amount, tx.currency);
  const fail = (when: boolean) => (when ? "fail" : "ok") as "fail" | "ok";

  const reject = (): Decision => {
    add(S.reject, { note: `REJECTED · ${code}`, outcome: "fail", evidence: "observado", data: tx });
    return "rejected";
  };

  add(d.origin === "worker" ? S.workerDecide : S.decide, { note: `${tx.kind} ${amount}` });

  const playerMismatch = code === "WALLET_PLAYER_MISMATCH";
  add(S.checkPlayer, {
    branch: { question: "a carteira é deste jogador?", answer: playerMismatch ? "não" : "sim" },
    outcome: fail(playerMismatch),
  });
  if (playerMismatch) return reject();

  const currencyMismatch = code === "CURRENCY_MISMATCH";
  add(S.checkCurrency, {
    branch: { question: "mesma moeda da carteira?", answer: currencyMismatch ? "não" : "sim" },
    outcome: fail(currencyMismatch),
  });
  if (currencyMismatch) return reject();

  if (tx.referenceExternalTransactionId) {
    const missing = tx.status === "PENDING_REFERENCE" || code === "REFERENCE_NOT_FOUND";
    add(S.findReference, {
      branch: {
        question: `a referência "${tx.referenceExternalTransactionId}" existe?`,
        answer: missing ? "não (ainda)" : `sim · ${d.reference?.kind} ${d.reference?.status}`,
      },
      outcome: missing ? undefined : "ok",
      evidence: "observado",
      data: d.reference ?? undefined,
    });
    if (missing) return "reference-missing";

    const invalid = REFERENCE_CODES.includes(code ?? "");
    add(S.validateReference, {
      branch: { question: "a referência é válida para este tipo?", answer: invalid ? `não → ${code}` : "sim" },
      outcome: fail(invalid),
    });
    if (invalid) return reject();

    if (tx.kind === "REFUND" || tx.kind === "ROLLBACK") {
      const reversed = code === "REFERENCE_ALREADY_REVERSED";
      add(S.alreadyReversed, {
        branch: { question: "essa transação já foi revertida?", answer: reversed ? "sim" : "não" },
        outcome: fail(reversed),
      });
      if (reversed) return reject();
    }
  }

  if (tx.kind === "LOSS") {
    add(S.noBalanceEffect, { outcome: "ok" });
    add(S.markProcessed, {
      note: `PROCESSED · saldo observado ${money(tx.observedBalanceAmount, tx.currency)}`,
      evidence: "observado",
      outcome: "ok",
    });
    return "processed";
  }

  const entry = d.ledger[0];
  const direction = (entry?.direction as string | undefined) ?? inferDirection(tx.kind as string, d.reference);
  add(S.direction, { note: `${tx.kind} → ${direction}`, evidence: entry ? "observado" : "inferido" });

  const balanceAtLock = d.walletAtLock?.balanceAmount ?? entry?.balanceBeforeAmount;
  const noFunds = FUNDS_CODES.includes(code ?? "");
  if (direction === "DEBIT") {
    add(S.walletDebit, {
      branch: {
        question: `saldo ${money(balanceAtLock, tx.currency)} cobre ${amount}?`,
        answer: noFunds ? `não → ${code}` : "sim",
      },
      outcome: fail(noFunds),
    });
  } else {
    add(S.walletCredit, { note: `+ ${amount}`, outcome: "ok" });
  }
  if (noFunds) return reject();

  if (entry) {
    add(S.ledgerEntry, {
      note: `${entry.direction} ${amount}: ${entry.balanceBeforeAmount} → ${entry.balanceAfterAmount}`,
      evidence: "observado",
      data: entry,
    });
  }
  add(S.markProcessed, {
    note: `PROCESSED · saldo observado ${money(tx.observedBalanceAmount, tx.currency)}`,
    evidence: "observado",
    outcome: "ok",
  });
  return "processed";
};

interface PersistInput {
  track?: string;
  origin: Origin;
  tx: Row;
  walletAtLock: Row | null;
  ledger: Row[];
  outbox: Row[];
  inbox?: Row | null;
  after: Snapshot;
}

/** Writes of the decided transaction, in the order the use case runs them, then COMMIT. */
const emitPersist = (sink: Sink, p: PersistInput) => {
  const add = (def: StepDef, extra: Extra = {}) => sink.add(def, { track: p.track, ...extra });
  const from = p.origin;

  const buildEvents =
    p.origin === "worker"
      ? { ...S.buildEvents, from: "domain" as const, code: { file: F.resolveUc, anchor: "switch (decision.outcome)", span: 22 } }
      : S.buildEvents;
  add(buildEvents, {
    note: byEmitOrder(p.outbox).map((row) => row.eventType).join(" + ") || "nenhum evento",
    evidence: p.outbox.length > 0 ? "observado" : "inferido",
  });

  const code = p.tx.failureCode ? ` · ${p.tx.failureCode}` : "";
  if (p.origin === "worker") add(S.workerSave, { note: `status ${p.tx.status}${code}`, evidence: "observado", data: p.tx });
  else add(S.insertTransaction, { note: `status ${p.tx.status}${code}`, evidence: "observado", data: p.tx });

  const entry = p.ledger[0];
  if (entry) {
    const version = p.walletAtLock ? ` · version ${p.walletAtLock.version} → ${Number(p.walletAtLock.version) + 1}` : "";
    add(
      { ...S.updateWallet, from },
      { note: `saldo ${entry.balanceBeforeAmount} → ${entry.balanceAfterAmount}${version}`, evidence: "observado" },
    );
    add({ ...S.insertLedger, from }, { note: `${entry.direction} ${entry.amount}`, evidence: "observado", data: entry });
  }

  for (const row of byEmitOrder(p.outbox)) {
    add(
      { ...S.insertOutbox, from, title: `INSERT outbox: ${row.eventType}` },
      { note: `eventId ${row.id} · published_at NULL`, evidence: "observado", data: row.payload },
    );
  }

  if (p.inbox) {
    add(S.inboxProcessed, {
      note: `processed_at ${p.inbox.processedAt ?? "—"}`,
      evidence: p.inbox.processedAt ? "observado" : "inferido",
    });
  }

  add({ ...S.commit, from }, { tx: "commit", lock: "release", note: invariantNote(p.after), outcome: "ok" });
};

export { emitDecision, emitPersist, type Decision, type Origin };
