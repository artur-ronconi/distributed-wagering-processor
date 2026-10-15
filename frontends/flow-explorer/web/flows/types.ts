/** Columns of the sequence diagram, left to right. */
type LaneId = "client" | "entry" | "usecase" | "domain" | "db" | "worker" | "sqs";

/** Points at real backend code: the first line containing `anchor` (after the line containing `after`). */
interface CodeRef {
  file: string;
  anchor: string;
  after?: string;
  /** How many lines to highlight, starting at the anchor. */
  span?: number;
}

type StepKind = "call" | "return" | "db" | "decision" | "error" | "async" | "wait" | "domain";

interface StepDef {
  lane: LaneId;
  /** Arrow origin. Defaults to the lane of the previous step of the same track. */
  from?: LaneId;
  title: string;
  /** Explanation in Portuguese. `code` in backticks is rendered as code. */
  detail: string;
  kind?: StepKind;
  code?: CodeRef;
  sql?: string;
}

/**
 * - observado: backed by evidence (HTTP response, database row, queue, app log);
 * - inferido: the code path implied by that evidence (the backend is not instrumented).
 */
type Evidence = "observado" | "inferido";

interface TraceStep extends StepDef {
  id: number;
  track?: string;
  note?: string;
  evidence: Evidence;
  outcome?: "ok" | "fail";
  branch?: { question: string; answer: string };
  data?: unknown;
  tx?: "begin" | "commit" | "rollback";
  lock?: "acquire" | "release" | "wait";
  section?: string;
}

export type { CodeRef, Evidence, LaneId, StepDef, StepKind, TraceStep };
