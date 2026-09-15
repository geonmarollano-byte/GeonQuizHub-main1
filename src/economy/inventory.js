/**
 * GEON'S GAMEHUB - inventory.js
 * Inventory boundary: item counts and consumption. Counts are clamped so
 * corrupted saves cannot grant infinite items.
 */
import { SHOP_ITEMS } from '../gameCore.js';

export function items() {
  return SHOP_ITEMS.map((i) => ({ ...i }));
}

export function count(state, itemId) {
  return state.itemCount(itemId);
}

export function consume(state, itemId) {
  return state.useItem(itemId);
}

export function add(state, itemId, n = 1) {
  return state.addItem(itemId, n);
}

export function snapshot(state) {
  const out = {};
  for (const item of SHOP_ITEMS) out[item.id] = state.itemCount(item.id);
  return out;
}
