import { LANES, laneIndex } from "../flows/lanes";
import type { LaneId, TraceStep } from "../flows/types";
import { escapeHtml } from "./dom";

const ROW = 46;
const TOP = 10;
const PAD_X = 34;
const SVG_NS = "http://www.w3.org/2000/svg";

const KIND_CLASS: Record<string, string> = {
  call: "k-call",
  return: "k-return",
  db: "k-db",
  decision: "k-decision",
  error: "k-error",
  async: "k-async",
  wait: "k-wait",
  domain: "k-domain",
};

interface RenderOptions {
  current: number;
  selected: number | null;
  animate: boolean;
  durationMs: number;
}

/**
 * Sequence diagram: one column per lane, one row per step. Rebuilt on every change (a few hundred
 * rows at most); only the current row is animated.
 */
class Diagram {
  private width = 900;
  private onSelect: (index: number) => void = () => {};

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly header: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    this.renderHeader();
    new ResizeObserver(() => {
      const width = Math.max(640, this.scroller.clientWidth);
      if (Math.abs(width - this.width) > 2) {
        this.width = width;
        this.renderHeader();
        this.redraw?.();
      }
    }).observe(this.scroller);
    this.svg.addEventListener("click", (event) => {
      const row = (event.target as Element).closest("[data-row]");
      if (row) this.onSelect(Number(row.getAttribute("data-row")));
    });
  }

  private redraw: (() => void) | null = null;

  setOnSelect(handler: (index: number) => void) {
    this.onSelect = handler;
  }

  private laneX(id: LaneId) {
    const inner = this.width - PAD_X * 2;
    return PAD_X + (inner / LANES.length) * (laneIndex(id) + 0.5);
  }

  private get laneWidth() {
    return (this.width - PAD_X * 2) / LANES.length;
  }

  private renderHeader() {
    this.header.innerHTML = "";
    this.header.style.setProperty("--pad", `${PAD_X}px`);
    for (const lane of LANES) {
      const cell = document.createElement("div");
      cell.className = `lane-head lane-${lane.id}`;
      cell.innerHTML = `<strong>${lane.label}</strong><small>${lane.sub}</small>`;
      this.header.append(cell);
    }
  }

  render(steps: TraceStep[], options: RenderOptions) {
    this.redraw = () => this.render(steps, { ...options, animate: false });
    const visible = steps.slice(0, options.current + 1);
    const height = TOP * 2 + Math.max(visible.length, 6) * ROW;
    const width = this.width;
    const parts: string[] = [];

    parts.push(this.defs());

    // lifelines
    for (const lane of LANES) {
      const x = this.laneX(lane.id);
      parts.push(`<line class="lifeline lane-${lane.id}" x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
    }

    // row backgrounds (clickable)
    visible.forEach((step, index) => {
      const y = TOP + index * ROW;
      const cls = ["row-bg"];
      if (index === options.current) cls.push("current");
      if (index === options.selected) cls.push("selected");
      if (step.section) cls.push("section-bg");
      parts.push(`<rect class="${cls.join(" ")}" data-row="${index}" x="0" y="${y}" width="${width}" height="${ROW}"/>`);
    });

    parts.push(...this.transactionBands(visible));
    parts.push(...this.lockBands(visible));

    visible.forEach((step, index) => {
      parts.push(this.row(step, index, index === options.current && options.animate, options.durationMs));
    });

    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.innerHTML = parts.join("");

    const focus = options.selected ?? options.current;
    const y = TOP + focus * ROW;
    const { scrollTop, clientHeight } = this.scroller;
    if (y < scrollTop + 20 || y + ROW > scrollTop + clientHeight - 20) {
      this.scroller.scrollTo({ top: Math.max(0, y - clientHeight / 2), behavior: options.animate ? "smooth" : "auto" });
    }
  }

  private defs() {
    const kinds = ["call", "return", "db", "decision", "error", "async", "wait", "domain"];
    const markers = kinds
      .map(
        (kind) =>
          `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead k-${kind}" d="M0,0 L10,5 L0,10 z"/></marker>`,
      )
      .join("");
    return `<defs>${markers}</defs>`;
  }

  /** "BEGIN … COMMIT" shading across the use case → database lanes. */
  private transactionBands(steps: TraceStep[]) {
    const bands: string[] = [];
    const open = new Map<string, { start: number }>();
    const draw = (track: string, start: number, end: number, state: "open" | "commit" | "rollback") => {
      // Spans the lanes that talk inside the transaction (use case ↔ database, or worker ↔ database).
      const lanes = steps
        .slice(start, end + 1)
        .filter((step) => (step.track ?? "") === track && !step.section)
        .flatMap((step) => [step.lane, step.from ?? step.lane])
        .filter((lane) => lane !== "client" && lane !== "sqs" && lane !== "entry")
        .map((lane) => this.laneX(lane));
      const left = Math.min(this.laneX("db"), ...lanes);
      const right = Math.max(this.laneX("db"), ...lanes);
      // Parallel requests get nested bands so both stay visible.
      const inset = track === "B" ? 10 : 0;
      const x1 = left - this.laneWidth * 0.42 + inset;
      const x2 = right + this.laneWidth * 0.42 - inset;
      const y = TOP + start * ROW + 4 + inset / 2;
      const h = (end - start + 1) * ROW - 8 - inset;
      const label = state === "rollback" ? "transação SQL (ROLLBACK)" : state === "open" ? "transação SQL aberta…" : "transação SQL";
      bands.push(
        `<g class="tx-band tx-${state}${track ? ` tx-track-${track}` : ""}"><rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" rx="10"/><text x="${x1 + 8}" y="${y + h - 6}">${label}${track ? ` · ${track}` : ""}</text></g>`,
      );
    };
    steps.forEach((step, index) => {
      const track = step.track ?? "";
      if (step.tx === "begin") open.set(track, { start: index });
      if (step.tx === "commit" || step.tx === "rollback") {
        const band = open.get(track);
        if (band) draw(track, band.start, index, step.tx);
        open.delete(track);
      }
    });
    for (const [track, band] of open) draw(track, band.start, steps.length - 1, "open");
    return bands;
  }

  /** Row lock held on the wallet: from SELECT … FOR UPDATE until COMMIT/ROLLBACK. */
  private lockBands(steps: TraceStep[]) {
    const bands: string[] = [];
    const held = new Map<string, number>();
    const x = this.laneX("db");
    const draw = (track: string, start: number, end: number, closed: boolean) => {
      const y = TOP + start * ROW + ROW / 2;
      const h = Math.max(8, (end - start) * ROW);
      const offset = track === "B" ? 12 : track === "A" ? -12 : 0;
      bands.push(
        `<g class="lock-band${closed ? "" : " open"}"><rect x="${x - 6 + offset}" y="${y}" width="12" height="${h}" rx="6"/><text x="${x + 10 + offset}" y="${y + 14}">🔒${track ? ` ${track}` : ""}</text></g>`,
      );
    };
    steps.forEach((step, index) => {
      const track = step.track ?? "";
      if (step.lock === "acquire") held.set(track, index);
      if (step.lock === "release" || ((step.tx === "commit" || step.tx === "rollback") && held.has(track))) {
        const start = held.get(track);
        if (start !== undefined) draw(track, start, index, true);
        held.delete(track);
      }
    });
    for (const [track, start] of held) draw(track, start, steps.length - 1, false);
    return bands;
  }

  private row(step: TraceStep, index: number, animate: boolean, durationMs: number) {
    const y = TOP + index * ROW + ROW / 2;
    if (step.section) {
      return `<g class="section" data-row="${index}"><line x1="8" y1="${y}" x2="${this.width - 8}" y2="${y}"/><text x="${this.width / 2}" y="${y + 4}" text-anchor="middle"><tspan class="section-pill">${escapeHtml(step.section)}</tspan></text></g>`;
    }

    const kind = step.kind ?? "call";
    const from = step.from ?? step.lane;
    const x1 = this.laneX(from);
    const x2 = this.laneX(step.lane);
    const self = Math.abs(x1 - x2) < 1;
    const cls = [KIND_CLASS[kind] ?? "k-call", step.outcome === "fail" ? "fail" : "", step.evidence === "observado" ? "observed" : "inferred"]
      .filter(Boolean)
      .join(" ");

    const path = self
      ? `M ${x1} ${y - 9} h 30 v 18 h -26`
      : `M ${x1 + Math.sign(x2 - x1) * 6} ${y} L ${x2 - Math.sign(x2 - x1) * 8} ${y}`;
    const length = self ? 74 : Math.abs(x2 - x1);
    const dash = kind === "async" || kind === "return" ? ' stroke-dasharray="6 5"' : kind === "wait" ? ' stroke-dasharray="2 4"' : "";
    const anim = animate ? ` class="draw" style="--len:${length};--dur:${Math.round(durationMs * 0.6)}ms"` : "";

    const labelX = self ? x1 + 38 : (x1 + x2) / 2;
    const anchor = self ? "start" : "middle";
    const maxChars = Math.max(18, Math.floor((self ? this.laneWidth * 2.3 : Math.abs(x2 - x1) + this.laneWidth * 0.9) / 6.4));
    const title = step.title.length > maxChars ? `${step.title.slice(0, maxChars - 1)}…` : step.title;

    const icon =
      step.lock === "wait" ? "⏳ " : kind === "decision" ? "◆ " : kind === "error" ? "✕ " : step.outcome === "fail" ? "✕ " : "";
    const track = step.track
      ? `<g class="track track-${step.track}"><circle cx="16" cy="${y}" r="9"/><text x="16" y="${y + 4}" text-anchor="middle">${step.track}</text></g>`
      : "";
    const evidence = step.evidence === "observado" ? `<circle class="evidence-dot" cx="${x2}" cy="${y}" r="4"/>` : "";
    const packet = animate
      ? `<circle class="packet ${KIND_CLASS[kind]}" r="5.5" style="offset-path: path('${path}'); --dur:${Math.round(durationMs * 0.6)}ms"/>`
      : "";

    return `<g class="step ${cls}" data-row="${index}">
      ${track}
      <path class="arrow"${anim} d="${path}"${dash} marker-end="url(#arrow-${kind})"/>
      <text class="label" x="${labelX}" y="${y - 8}" text-anchor="${anchor}">${icon}${escapeHtml(title)}</text>
      ${evidence}
      ${packet}
    </g>`;
  }
}

const createSvg = () => document.createElementNS(SVG_NS, "svg");

export { createSvg, Diagram };
