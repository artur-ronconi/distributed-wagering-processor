import type { HttpExchange, ReceivedEvent, Snapshot } from "../api";
import type { Trace } from "./trace";
import type { StepDef, TraceStep } from "./types";

type Extra = Partial<Omit<TraceStep, "id" | keyof StepDef>> & Partial<StepDef>;

/** Anything steps can be written to: the live trace, or a recorder (to interleave parallel requests). */
interface Sink {
  add(def: StepDef, extra?: Extra): void;
}

/** Records steps to replay them later in another order (used by the concurrency scenario). */
class Recorder implements Sink {
  readonly entries: Array<{ def: StepDef; extra: Extra }> = [];

  add(def: StepDef, extra: Extra = {}): void {
    this.entries.push({ def, extra });
  }

  indexOf(predicate: (entry: { def: StepDef; extra: Extra }) => boolean): number {
    return this.entries.findIndex(predicate);
  }

  replay(trace: Trace, from = 0, to = this.entries.length): void {
    for (const { def, extra } of this.entries.slice(from, to)) trace.add(def, extra);
  }
}

type ResultCard =
  | { type: "http"; title: string; exchange: HttpExchange; track?: string }
  | { type: "snapshot"; title: string; before?: Snapshot; after: Snapshot; track?: string }
  | { type: "events"; title: string; events: ReceivedEvent[] }
  | { type: "logs"; title: string; lines: unknown[] }
  | { type: "message"; title: string; payload: unknown; meta?: Record<string, unknown> }
  | { type: "note"; title: string; text: string; tone?: "ok" | "warn" | "fail" };

interface RunContext {
  trace: Trace;
  record(card: ResultCard): void;
}

export { Recorder, type Extra, type ResultCard, type RunContext, type Sink };
