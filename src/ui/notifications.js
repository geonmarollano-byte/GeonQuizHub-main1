/**
 * GEON'S GAMEHUB - notifications.js
 * Notification boundary: toast messages with auto-dismiss.
 */
import { el } from './render.js';

export class Notifier {
  constructor(container) {
    this.container = container;
  }

  toast(message, { kind = 'info', ms = 2600 } = {}) {
    if (!this.container || !message) return;
    const node = el('div', { class: `toast toast-${kind}`, role: 'status', text: String(message) });
    this.container.appendChild(node);
    setTimeout(() => {
      node.classList.add('toast-out');
      setTimeout(() => node.remove(), 400);
    }, ms);
  }

  coins(amount) {
    if (amount > 0) this.toast(`+${amount} coins`, { kind: 'coin' });
  }

  points(amount) {
    if (amount > 0) this.toast(`+${amount} points`, { kind: 'point' });
  }
}
