import type { Trace } from "../flows/trace";
import type { TraceStep } from "../flows/types";
import { h } from "./dom";

const BASE_MS = 1_100;
const SPEEDS = [0.5, 1, 2, 4];

type View = (state: { steps: TraceStep[]; current: number; selected: number | null; animate: boolean; durationMs: number }) => void;

/**
 * Reveals the trace one step at a time. New steps can arrive while playing (async parts):
 * when the player catches up it waits for them.
 */
class Player {
  private trace: Trace | null = null;
  private unsubscribe: (() => void) | null = null;
  private current = -1;
  private selected: number | null = null;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private speed = 1;

  private readonly playButton = h("button", { class: "btn icon", title: "play / pausa (espaço)", onclick: () => this.toggle() }, "▶");
  private readonly position = h("span", { class: "player-pos" }, "—");
  private readonly liveDot = h("span", { class: "live-dot", title: "ainda coletando evidências" });

  constructor(
    container: HTMLElement,
    private readonly view: View,
  ) {
    const speedSelect = h(
      "select",
      { class: "speed", title: "velocidade", onchange: (event: Event) => (this.speed = Number((event.target as HTMLSelectElement).value)) },
      ...SPEEDS.map((speed) => h("option", { value: speed, selected: speed === 1 }, `${speed}×`)),
    );
    container.append(
      h("button", { class: "btn icon", title: "início", onclick: () => this.goTo(0) }, "⏮"),
      h("button", { class: "btn icon", title: "passo anterior (←)", onclick: () => this.step(-1) }, "◀"),
      this.playButton,
      h("button", { class: "btn icon", title: "próximo passo (→)", onclick: () => this.step(1) }, "▶|"),
      h("button", { class: "btn icon", title: "mostrar tudo", onclick: () => this.goTo(Number.MAX_SAFE_INTEGER) }, "⏭"),
      speedSelect,
      this.position,
      this.liveDot,
      h(
        "span",
        { class: "legend" },
        h("span", { class: "legend-item observed" }, "● observado"),
        h("span", { class: "legend-item inferred" }, "○ inferido do código"),
      ),
    );

    document.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).closest("input, textarea, select")) return;
      if (event.key === " ") {
        event.preventDefault();
        this.toggle();
      } else if (event.key === "ArrowRight") this.step(1);
      else if (event.key === "ArrowLeft") this.step(-1);
    });
  }

  load(trace: Trace) {
    this.unsubscribe?.();
    this.stopTimer();
    this.trace = trace;
    this.current = -1;
    this.selected = null;
    this.playing = true;
    this.unsubscribe = trace.onChange(() => this.onTraceChange());
    this.render(false);
    this.schedule(150);
  }

  select(index: number) {
    this.selected = index;
    this.setPlaying(false);
    this.render(false);
  }

  private onTraceChange() {
    if (this.playing && !this.timer) this.schedule(80);
    this.render(false, true);
  }

  private get steps() {
    return this.trace?.steps ?? [];
  }

  private get duration() {
    return BASE_MS / this.speed;
  }

  private schedule(delay: number) {
    this.stopTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, delay);
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private advance() {
    if (!this.playing) return;
    if (this.current < this.steps.length - 1) {
      this.current += 1;
      this.selected = null;
      this.render(true);
      const step = this.steps[this.current];
      this.schedule(step?.section ? this.duration * 0.8 : this.duration);
    } else if (this.trace?.finished) {
      this.setPlaying(false);
    }
    // otherwise: wait for onTraceChange
  }

  private step(delta: number) {
    this.setPlaying(false);
    this.goTo(Math.max(0, (this.selected ?? this.current) + delta), true);
  }

  private goTo(index: number, animate = false) {
    if (index === Number.MAX_SAFE_INTEGER) this.setPlaying(false);
    this.current = Math.min(Math.max(index, 0), this.steps.length - 1);
    this.selected = null;
    this.render(animate);
  }

  private toggle() {
    if (!this.trace) return;
    if (!this.playing && this.current >= this.steps.length - 1 && this.trace.finished) this.current = -1;
    this.setPlaying(!this.playing);
    if (this.playing) this.schedule(50);
  }

  private setPlaying(playing: boolean) {
    this.playing = playing;
    if (!playing) this.stopTimer();
    this.playButton.textContent = playing ? "⏸" : "▶";
  }

  private render(animate: boolean, positionOnly = false) {
    const total = this.steps.length;
    this.position.textContent = total === 0 ? "—" : `passo ${Math.max(0, this.current + 1)} / ${total}`;
    this.liveDot.classList.toggle("on", Boolean(this.trace && !this.trace.finished));
    if (positionOnly) return;
    this.view({
      steps: this.steps,
      current: this.current,
      selected: this.selected,
      animate,
      durationMs: this.duration,
    });
  }
}

export { Player };
