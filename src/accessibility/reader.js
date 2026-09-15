/**
 * GEON'S GAMEHUB - reader.js
 * AI Reader / accessibility boundary. Documented functions:
 * aiReaderSpeak, aiReaderStop, aiReaderReadCurrentScreen,
 * aiReaderReadVisibleScreenFromUserGesture, aiReaderRefresh,
 * aiReaderSpeakFeedback.
 *
 * TARGETING CONTRACT (bug fix): the reader NEVER scrapes whole screens.
 * It speaks ONLY
 *   1. elements explicitly marked data-ai-reader="true" (quiz questions in
 *      every level, reviewer questions, story passages + story questions,
 *      mission/problem briefs + questions), and
 *   2. the fixed answer-feedback phrases in READER_FEEDBACK.
 * Menus, buttons, navigation, Shop, Inventory, Profile, Settings, points,
 * coins, titles, achievements and every other screen content stay silent.
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

export class AIReader {
  /**
   * @param {object} opts
   *   settings: SettingsState-like with get('reader')
   *   synth:    optional SpeechSynthesis implementation (tests)
   *   getActiveScreen: () => HTMLElement|null
   */
  constructor({ settings, synth, getActiveScreen } = {}) {
    this.settings = settings || null;
    this.synth = synth || (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);
    this.getActiveScreen = getActiveScreen || (() => null);
    this.lastSpoken = '';
  }

  get enabled() {
    if (!this.settings) return false;
    return typeof this.settings.get === 'function' ? this.settings.get('reader') : Boolean(this.settings.reader);
  }

  /**
   * aiReaderSpeak - cancel any speech in flight, then speak `text`.
   * Cancelling first guarantees feedback and question speech never overlap
   * and that rapid question changes replace the previous utterance.
   */
  speak(text) {
    if (!this.enabled || !this.synth || !text) return false;
    try {
      this.synth.cancel();
      const utter = new (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : Object)();
      if (typeof SpeechSynthesisUtterance !== 'undefined') {
        utter.text = String(text).slice(0, 4000);
        utter.rate = 1;
        utter.pitch = 1;
        this.synth.speak(utter);
        this.lastSpoken = utter.text;
        return true;
      }
      // test double path
      if (this.synth.__utterances) {
        this.synth.__utterances.push({ text: String(text) });
        this.lastSpoken = String(text);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /** aiReaderStop */
  stop() {
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
