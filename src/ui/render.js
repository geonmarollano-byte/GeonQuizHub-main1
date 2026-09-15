/**
 * GEON'S GAMEHUB - render.js
 * Rendering boundary: small DOM helpers shared by the UI layer.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function setText(id, text) {
  const node = typeof id === 'string' ? document.getElementById(id) : id;
  if (node) node.textContent = text == null ? '' : String(text);
}

/** Render the four answer buttons for a quiz question. */
export function renderChoices(container, choices, { onSelect, eliminated = [] } = {}) {
  clear(container);
  choices.forEach((choice, i) => {
    const letter = String.fromCharCode(65 + i);
    const btn = el(
      'button',
      {
        class: 'choice-btn',
        type: 'button',
        onclick: () => onSelect && onSelect(choice, btn),
      },
      [el('span', { class: 'choice-letter', text: letter }), el('span', { class: 'choice-text', text: choice })]
    );
    if (eliminated.includes(choice)) {
      btn.classList.add('eliminated');
      btn.disabled = true;
    }
    container.appendChild(btn);
  });
}

/** Simple progress bar element update (0..1). */
export function setBar(bar, ratio) {
  if (!bar) return;
  const pct = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  bar.style.width = `${pct}%`;
}
