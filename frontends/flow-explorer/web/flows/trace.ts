import type { LaneId, StepDef, TraceStep } from "./types";

type Extra = Partial<Omit<TraceStep, "id" | keyof StepDef>> & Partial<StepDef>;

type Listener = () => void;

/**
 * The steps of one execution. Grows while the flow runs (async parts such as the outbox publisher
 * are appended when their evidence shows up), and the player animates it as it grows.
 */
class Trace {
  readonly steps: TraceStep[] = [];
  finished = false;
  private nextId = 1;
  private readonly lastLane = new Map<string, LaneId>();
  private readonly listeners = new Set<Listener>();

  constructor(readonly title: string) {}

  /** Adds a step. Unless `from` is given, the arrow starts at the lane where this track last was. */
  add(def: StepDef, extra: Extra = {}): TraceStep {
    const track = extra.track ?? "";
    const step: TraceStep = {
      evidence: "inferido",
      ...def,
      ...extra,
      from: extra.from ?? def.from ?? this.lastLane.get(track) ?? "client",
      id: this.nextId++,
    };
    this.lastLane.set(track, step.lane);
    this.steps.push(step);
    this.emit();
    return step;
  }

  /** A header row that splits a multi-request scenario into parts. */
  section(title: string, track = ""): void {
    this.steps.push({
      id: this.nextId++,
      lane: "client",
      from: "client",
      title,
      detail: "",
      evidence: "observado",
      section: title,
      track,
    });
    this.lastLane.set(track, "client");
    this.emit();
  }

  /** Where the next arrow of `track` starts. */
  moveTo(lane: LaneId, track = ""): void {
    this.lastLane.set(track, lane);
  }

  finish(): void {
    this.finished = true;
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export { Trace };
