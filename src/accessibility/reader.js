/**
 * GEON'S GAMEHUB - reader.js
 * AI Reader / accessibility boundary. Documented functions:
 * aiReaderSpeak, aiReaderStop, aiReaderReadCurrentScreen,
 * aiReaderReadVisibleScreenFromUserGesture, aiReaderRefresh.
 * Uses the Web Speech API when available; every method is a safe no-op
 * elsewhere (Node tests, unsupported browsers).
 */
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

  /** aiReaderSpeak */
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

  /** Extract readable text from a screen element (DOM-free fallback: ''). */
  static extractText(root) {
    if (!root) return '';
    if (typeof root.innerText === 'string') return root.innerText;
    if (typeof root.textContent === 'string') return root.textContent;
    return '';
  }

  /** aiReaderReadCurrentScreen */
  readCurrentScreen() {
    const screen = this.getActiveScreen();
    const text = AIReader.extractText(screen);
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
