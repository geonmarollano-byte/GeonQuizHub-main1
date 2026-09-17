/**
 * GEON'S GAMEHUB - reader.js
 * AI Reader / accessibility boundary. Documented functions:
 * aiReaderSpeak, aiReaderStop, aiReaderReadCurrentScreen,
 * aiReaderReadVisibleScreenFromUserGesture, aiReaderRefresh,
 * aiReaderSpeakFeedback.
 *
 * TARGETING CONTRACT (bug fix): the reader NEVER scrapes whole screens.
 * It speaks ONLY
 *   1. the caller-supplied active content string (quiz questions in every
 *      level, reviewer questions, story passages + story questions,
 *      mission/problem briefs + questions - passed directly by script.js
 *      from the live game data, not scraped from surrounding UI), or
 *   2. elements explicitly marked data-ai-reader="true" (screen-entry path),
 *   3. the fixed answer-feedback phrases in READER_FEEDBACK.
 * Menus, buttons, navigation, Shop, Inventory, Profile, Settings, points,
 * coins, titles, achievements and every other screen content stay silent.
 *
 * REAL-BROWSER HARDENING (bug fix): browsers are allowed to silently drop an
 * utterance spoken synchronously after speechSynthesis.cancel() (long-
 * standing Chrome/Firefox behavior) and Android Chrome can leave the
 * synthesis queue paused. Because every legitimate speech transition
 * (question -> feedback -> next question) cancels first, an unlucky drop
 * meant the active question was never heard. Every speak is now
 *   - generation-stamped, so stop()/new speech invalidates stale work,
 *   - preceded by synth.resume() where available,
 *   - guarded by a one-shot watchdog timer that re-speaks ONLY when the
 *     utterance provably never started and the queue is idle,
 *   - kept alive during long passages (story text) by a resume ping so
 *     desktop engines do not stall mid-way.
 * All of this is active only with a real (native) SpeechSynthesis
 * implementation; the test doubles used by the Node/jsdom suites keep the
 * deterministic synchronous behavior.
 *
 * Uses the Web Speech API when available; every method is a safe no-op
 * elsewhere (Node tests, unsupported browsers).
 */

/** Elements marked with this attribute are the ONLY screen content spoken. */
export const AI_READER_ATTRIBUTE = 'data-ai-reader';

/** Documented spoken feedback phrases for answer outcomes. */
export const READER_FEEDBACK = Object.freeze({
  correct: 'Excellent!',
  wrong: 'Incorrect.',
  timeout: "Time's up.",
});

/** How long to wait for an utterance to start before one guarded re-speak. */
const DEFAULT_RETRY_DELAY_MS = 400;
/** Desktop engines can stall ~15s into long passages; resume ping interval. */
const KEEP_ALIVE_INTERVAL_MS = 10000;

export class AIReader {
  /**
   * @param {object} opts
   *   settings: SettingsState-like with get('reader')
   *   synth:    optional SpeechSynthesis implementation (tests)
   *   getActiveScreen: () => HTMLElement|null
   *   retryDelayMs: watchdog delay before one guarded re-speak (tests inject
   *                 a small value; production uses the default)
   */
  constructor({ settings, synth, getActiveScreen, retryDelayMs } = {}) {
    this.settings = settings || null;
    this.synth = synth || (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);
    this.getActiveScreen = getActiveScreen || (() => null);
    this.retryDelayMs = typeof retryDelayMs === 'number' ? retryDelayMs : DEFAULT_RETRY_DELAY_MS;
    this.lastSpoken = '';
    // Bumped by speak() and stop() so any timer scheduled by older speech is
    // discarded - a stale question can never be spoken after a new one loads.
    this._generation = 0;
    this._retryTimer = null;
    this._keepAliveTimer = null;
  }

  get enabled() {
    if (!this.settings) return false;
    return typeof this.settings.get === 'function' ? this.settings.get('reader') : Boolean(this.settings.reader);
  }

  /**
   * True when the synth looks like a real browser implementation (event and
   * speaking/pending state support). Plain test doubles deliberately stay
   * "non-native" and keep purely synchronous behavior.
   */
  get _native() {
    return Boolean(this.synth)
      && typeof this.synth.speak === 'function'
      && (typeof this.synth.getVoices === 'function' || 'speaking' in this.synth || 'pending' in this.synth);
  }

  _clearRetryTimer() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  /**
   * Perform the actual synth call for one speak record. Handles both the
   * native API path and the plain Node test-double path (`__utterances`).
   */
  _speakNow(rec) {
    try {
      if (typeof this.synth.resume === 'function') {
        // Android Chrome can leave the queue paused after navigation.
        try {
          this.synth.resume();
        } catch {
          /* ignore */
        }
      }
      if (typeof SpeechSynthesisUtterance !== 'undefined') {
        const utter = new SpeechSynthesisUtterance();
        utter.text = rec.text;
        utter.rate = 1;
        utter.pitch = 1;
        utter.onstart = () => {
          rec.started = true;
          this._startKeepAlive();
        };
        utter.onend = () => {
          rec.ended = true;
          this._stopKeepAlive();
        };
        utter.onerror = () => {
          rec.errored = true;
          this._stopKeepAlive();
        };
        this.synth.speak(utter);
        return true;
      }
      // test double path
      if (this.synth.__utterances) {
        this.synth.__utterances.push({ text: rec.text });
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Watchdog: after `retryDelayMs`, if this speak is still the newest work
   * (generation unchanged), the utterance never started/ended/errored, and
   * the queue is idle, the browser dropped it - cancel and re-speak ONCE.
   */
  _armWatchdog(rec, gen) {
    this._clearRetryTimer();
    if (!this._native || !this.retryDelayMs) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (gen !== this._generation || !this.enabled) return;
      if (rec.started || rec.ended || rec.errored || rec.retried) return;
      let busy = false;
      try {
        busy = Boolean(this.synth.speaking || this.synth.pending);
      } catch {
        busy = false;
      }
      if (busy) return;
      rec.retried = true;
      try {
        this.synth.cancel();
      } catch {
        /* ignore */
      }
      this._speakNow(rec);
    }, this.retryDelayMs);
    if (typeof this._retryTimer.unref === 'function') this._retryTimer.unref();
  }

  /**
   * Keep-alive ping for long utterances (story passages): desktop engines
   * can stall tens of seconds into speech; a periodic resume() prevents it.
   * Runs only between onstart and onend/onerror of a native utterance.
   */
  _startKeepAlive() {
    if (!this._native || this._keepAliveTimer || typeof this.synth.resume !== 'function') return;
    this._keepAliveTimer = setInterval(() => {
      try {
        if (this.synth.speaking && !this.synth.paused) this.synth.resume();
      } catch {
        /* ignore */
      }
    }, KEEP_ALIVE_INTERVAL_MS);
    if (typeof this._keepAliveTimer.unref === 'function') this._keepAliveTimer.unref();
  }

  /**
   * aiReaderSpeak - cancel any speech in flight, then speak `text`.
   * Cancelling first guarantees feedback and question speech never overlap
   * and that rapid question changes replace the previous utterance. The
   * generation stamp makes sure only the newest speech may schedule retries.
   */
  speak(text) {
    if (!this.enabled || !this.synth || !text) return false;
    const content = String(text).slice(0, 4000);
    this._generation += 1;
    const gen = this._generation;
    this._clearRetryTimer();
    this._stopKeepAlive();
    try {
      this.synth.cancel();
    } catch {
      /* ignore */
    }
    const rec = { text: content, started: false, ended: false, errored: false, retried: false };
    if (this._speakNow(rec)) {
      this.lastSpoken = content;
      this._armWatchdog(rec, gen);
      return true;
    }
    return false;
  }

  /** aiReaderStop - cancel speech and discard any pending guarded re-speak. */
  stop() {
    this._generation += 1;
    this._clearRetryTimer();
    this._stopKeepAlive();
    try {
      if (this.synth && typeof this.synth.cancel === 'function') this.synth.cancel();
    } catch {
      /* ignore */
    }
  }

  /**
   * aiReaderSpeakFeedback - speak the fixed phrase for an answer outcome.
   * @param {'correct'|'wrong'|'timeout'} kind
   */
  speakFeedback(kind) {
    const phrase = READER_FEEDBACK[kind];
    if (!phrase) return false;
    return this.speak(phrase);
  }

  /** Extract readable text from an element (legacy helper; DOM-free fallback: ''). */
  static extractText(root) {
    if (!root) return '';
    if (typeof root.innerText === 'string') return root.innerText;
    if (typeof root.textContent === 'string') return root.textContent;
    return '';
  }

  /**
   * Extract ONLY explicitly targeted readable text: the elements inside
   * `root` marked data-ai-reader="true", in DOM order, joined with a space.
   * Anything else in the screen (menus, buttons, HUD, decorative text) is
   * ignored, so the reader can never be tricked into scraping the DOM.
   * DOM-free fallback: ''.
   */
  static extractReadableText(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return '';
    let nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll(`[${AI_READER_ATTRIBUTE}="true"]`));
    } catch {
      return '';
    }
    if (typeof root.matches === 'function' && root.matches(`[${AI_READER_ATTRIBUTE}="true"]`)) {
      nodes.unshift(root);
    }
    const parts = [];
    for (const node of nodes) {
      const raw = typeof node.innerText === 'string' ? node.innerText : node.textContent;
      const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
    return parts.join(' ');
  }

  /**
   * aiReaderReadCurrentScreen - speak ONLY the current screen's explicitly
   * targeted readable content (quiz question, story passage, mission brief +
   * question...). Screens without readable content (Home, menus, Shop,
   * Inventory, Profile, Settings, results...) stay silent.
   */
  readCurrentScreen() {
    const screen = this.getActiveScreen();
    const text = AIReader.extractReadableText(screen);
    if (!text) return false;
    return this.speak(text);
  }

  /**
   * Speak caller-supplied active content (the active question / story /
   * problem text taken directly from the live game data after it was
   * rendered). Falls back to the screen's explicitly marked DOM content
   * when no text is supplied. This never scrapes unrelated UI.
   */
  speakActiveContent(text) {
    const content = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!content) return this.readCurrentScreen();
    return this.speak(content);
  }

  /** aiReaderReadVisibleScreenFromUserGesture - same, but only when enabled. */
  readVisibleScreenFromUserGesture() {
    if (!this.enabled) return false;
    return this.readCurrentScreen();
  }

  /** aiReaderRefresh - stop current speech and re-read the active screen. */
  refresh() {
    this.stop();
    if (this.enabled) this.readCurrentScreen();
  }
}
