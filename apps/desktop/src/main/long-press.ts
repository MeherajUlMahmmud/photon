/**
 * Recognises Ctrl + long press of the left mouse button from a stream of
 * global mouse events. Pure: timers are injected so tests drive the clock.
 * Fires once per press, after `holdMs` with the button still down and the
 * pointer within `slopPx` of where it went down.
 */

export type LongPressOptions = {
  holdMs: number;
  slopPx: number;
  onFire: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type PointerDown = { x: number; y: number; button: number; ctrlKey: boolean };

export const LEFT_BUTTON = 1;

export class LongPressDetector {
  private timer: unknown = null;
  private origin: { x: number; y: number } | null = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: LongPressOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  down(e: PointerDown): void {
    this.cancel();
    if (e.button !== LEFT_BUTTON || !e.ctrlKey) return;
    this.origin = { x: e.x, y: e.y };
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.origin = null;
      this.opts.onFire();
    }, this.opts.holdMs);
  }

  move(x: number, y: number): void {
    if (!this.origin) return;
    if (Math.hypot(x - this.origin.x, y - this.origin.y) > this.opts.slopPx) this.cancel();
  }

  /** Button released: the press is over. */
  cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.origin = null;
  }
}
