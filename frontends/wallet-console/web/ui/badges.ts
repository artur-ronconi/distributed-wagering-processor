import { display } from "../money";
import { explainSubmit, KIND_LABEL, STATUS_LABEL, type Explanation } from "../rules";
import { store, type ConsoleTransaction, type RoundState } from "../store";
import { h, rich } from "./dom";

const STATUS_TONE: Record<string, string> = {
  PROCESSED: "ok",
  REJECTED: "fail",
  PENDING_REFERENCE: "warn",
  PENDING: "warn",
  FAILED: "fail",
  ERROR: "fail",
};

const statusBadge = (status: string) => h("span", { class: `badge ${STATUS_TONE[status] ?? "info"}` }, STATUS_LABEL[status] ?? status);

const kindBadge = (kind: string) => h("span", { class: `kind kind-${kind.toLowerCase()}` }, KIND_LABEL[kind] ?? kind);

const ROUND_LABEL: Record<RoundState, [string, string]> = {
  open: ["Em aberto", "warn"],
  won: ["Ganhou", "ok"],
  lost: ["Perdeu", "fail"],
  refunded: ["Reembolsada", "info"],
  rolledback: ["Estornada", "info"],
  rejected: ["Aposta recusada", "fail"],
  pending: ["Aguardando", "warn"],
};

const roundBadge = (state: RoundState) => {
  const [label, tone] = ROUND_LABEL[state];
  return h("span", { class: `badge ${tone}` }, label);
};

/** Signed amount as it affects the balance. */
const movement = (tx: ConsoleTransaction) => {
  if (tx.status !== "PROCESSED" || tx.kind === "LOSS") return h("span", { class: "amount neutral" }, display(tx.amount));
  // A ROLLBACK does the opposite of what it undoes: undoing a BET credits, undoing a WIN or REFUND debits.
  const undone = tx.kind === "ROLLBACK" ? store.transaction(tx.referenceExternalTransactionId ?? "") : null;
  const credit = tx.kind === "WIN" || tx.kind === "REFUND" || tx.kind === "DEPOSIT" || undone?.kind === "BET";
  return h("span", { class: `amount ${credit ? "credit" : "debit"}` }, `${credit ? "+" : "−"} ${display(tx.amount)}`);
};

const explanationCard = (explanation: Explanation, extra?: Node | null) =>
  h(
    "div",
    { class: `explain ${explanation.tone}` },
    h("strong", {}, explanation.title),
    h("p", {}, rich(explanation.text)),
    extra ?? null,
  );

const txExplanation = (tx: ConsoleTransaction): Explanation =>
  explainSubmit(
    tx.httpStatus,
    { status: tx.status, failureCode: tx.failureCode, idempotentReplay: false },
    tx.status === "ERROR" ? { code: tx.failureCode ?? "", message: "" } : null,
  );

export { explanationCard, kindBadge, movement, roundBadge, statusBadge, txExplanation };
