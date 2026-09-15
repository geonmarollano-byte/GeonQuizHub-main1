/**
 * GEON'S GAMEHUB - overlays.js
 * Overlay boundary: achievement popups and confirm dialogs. One overlay at a
 * time; queued presentations so achievements are never lost or doubled.
 */
import { el, clear } from './render.js';

export class OverlayManager {
  constructor(container) {
    this.container = container;
    this.queue = [];
    this.showing = false;
  }

  achievement({ name, description, icon = '🏆' }) {
    this.queue.push({ name, description, icon });
    this._drain();
  }

  milestone(label) {
    this.queue.push({ name: label, description: 'Keep climbing!', icon: '🎯' });
    this._drain();
  }

  _drain() {
    if (this.showing || !this.queue.length || !this.container) return;
    const item = this.queue.shift();
    this.showing = true;
    clear(this.container);
    const card = el('div', { class: 'achv-card' }, [
      el('div', { class: 'achv-icon', text: item.icon }),
      el('div', { class: 'achv-name', text: item.name }),
      el('div', { class: 'achv-desc', text: item.description }),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Nice!',
        onclick: () => this._close(),
      }),
    ]);
    this.container.appendChild(card);
    this.container.classList.add('visible');
  }

  _close() {
    this.showing = false;
    if (this.container) {
      this.container.classList.remove('visible');
      clear(this.container);
    }
    this._drain();
  }

  /** Confirm dialog returning a Promise<boolean>. */
  confirm({ title, message, okLabel = 'Confirm', cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve(false);
        return;
      }
      this.showing = true;
      clear(this.container);
      const done = (result) => {
        this.showing = false;
        this.container.classList.remove('visible');
        clear(this.container);
        this._drain();
        resolve(result);
      };
      const card = el('div', { class: 'confirm-card' }, [
        el('div', { class: 'confirm-title', text: title }),
        el('div', { class: 'confirm-msg', text: message }),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', text: cancelLabel, onclick: () => done(false) }),
          el('button', { class: 'btn btn-primary', type: 'button', text: okLabel, onclick: () => done(true) }),
        ]),
      ]);
      this.container.appendChild(card);
      this.container.classList.add('visible');
    });
  }
}
