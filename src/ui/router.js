/**
 * GEON'S GAMEHUB - router.js
 * Screen routing boundary: shows one screen at a time, keeps a back stack,
 * and announces changes to assistive tech via the live region hook.
 */
export class Router {
  /**
   * @param {object} opts
   *   screens:    NodeList/Array of screen elements (each has id like 'screen-home')
   *   onChange:   (screenId, previousId) => void
   *   screenClass: class toggled for visibility (default 'active')
   */
  constructor({ screens, onChange, screenClass = 'active' } = {}) {
    this.screens = Array.from(screens || []);
    this.screenClass = screenClass;
    this.onChange = onChange || (() => {});
    this.history = [];
    this.current = null;
  }

  _screenById(id) {
    const full = id.startsWith('screen-') ? id : `screen-${id}`;
    return this.screens.find((s) => s.id === full) || null;
  }

  show(id, { pushHistory = true } = {}) {
    const next = this._screenById(id);
    if (!next) return false;
    const prev = this.current;
    // Showing the screen that is already active is a no-op. This keeps
    // double navigation (e.g. Start Your Mission renders AND the nav handler
    // both showing 'mission') from firing onChange twice - which would speak
    // the screen's readable content twice and replay the click sound.
    if (prev === next) return true;
    if (pushHistory && prev && prev !== next) this.history.push(prev.id);
    if (this.history.length > 40) this.history.shift();
    for (const s of this.screens) s.classList.remove(this.screenClass);
    next.classList.add(this.screenClass);
    this.current = next;
    try {
      next.scrollTop = 0;
    } catch {
      /* ignore */
    }
    this.onChange(next.id.replace('screen-', ''), prev ? prev.id.replace('screen-', '') : null);
    return true;
  }

  back(fallback = 'home') {
    const prevId = this.history.pop();
    if (prevId && this._screenById(prevId)) {
      this.show(prevId, { pushHistory: false });
      return true;
    }
    this.show(fallback, { pushHistory: false });
    return false;
  }
}
