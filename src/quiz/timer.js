/**
 * GEON'S GAMEHUB - timer.js
 * Timer boundary: ONE timer instance per quiz question (the blueprint flags
 * duplicate timers as a defect to avoid). Supports the documented 30-second
 * question timer, +10s Time Boost, and manual ticking for tests.
 */
export class QuizTimer {
  /**
   * @param {object} opts
   *   seconds:   initial seconds (30 documented)
   *   onTick:    (remainingSeconds:number) => void
   *   onTimeout: () => void
   *   intervalMs: tick resolution (default 250)
   *   manual:    true => no wall clock; drive with tick(dtSeconds)
   */
  constructor({ seconds = 30, onTick, onTimeout, intervalMs = 250, manual = false } = {}) {
    this.totalSeconds = seconds;
    this.remaining = seconds;
    this.onTick = onTick || (() => {});
    this.onTimeout = onTimeout || (() => {});
    this.intervalMs = intervalMs;
    this.manual = manual;
    this._handle = null;
    this._firedTimeout = false;
  }

  start() {
    this.stop();
    this._firedTimeout = false;
    this.onTick(this.remaining);
    if (this.manual) return this;
    this._handle = setInterval(() => this._advance(this.intervalMs / 1000), this.intervalMs);
    return this;
  }

  /** Manual clock advance (tests / paused environments). */
  tick(dtSeconds) {
    this._advance(dtSeconds);
  }

  _advance(dt) {
    if (this._firedTimeout) return;
    this.remaining = Math.max(0, this.remaining - dt);
    this.onTick(Math.ceil(this.remaining));
    if (this.remaining <= 0 && !this._firedTimeout) {
      this._firedTimeout = true;
      this.stop();
      this.onTimeout();
    }
  }

  /** Time Boost item: +10 seconds (documented). */
  addSeconds(n) {
    this.remaining += Math.max(0, Number(n) || 0);
    this.onTick(Math.ceil(this.remaining));
    return this.remaining;
  }

  stop() {
    if (this._handle) {
      clearInterval(this._handle);
      this._handle = null;
    }
    return this;
  }

  get running() {
    return this._handle !== null;
  }
}
