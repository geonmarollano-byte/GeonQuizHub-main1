/**
 * GEON'S GAMEHUB - shop.js
 * Shop boundary: documented item catalog and safe purchase flow.
 * Prices: Life Token 100, Time Boost 75, Hint 100, 50/50 150, Second Chance 200.
 */
import { SHOP_ITEMS, shopItemById } from '../gameCore.js';

export function catalog() {
  return SHOP_ITEMS.map((item) => ({ ...item }));
}

/**
 * Purchase an item. Coins are spent only when the whole transaction succeeds.
 * @returns {{ok:boolean, reason?:string, item?:object}}
 */
export function purchase(state, itemId, quantity = 1) {
  const item = shopItemById(itemId);
  if (!item) return { ok: false, reason: 'unknown item' };
  const qty = Math.floor(Number(quantity) || 0);
  if (qty <= 0 || qty > 99) return { ok: false, reason: 'invalid quantity' };
  const cost = item.price * qty;
  if (state.economy.coins < cost) return { ok: false, reason: 'not enough coins' };
  if (!state.spendCoins(cost)) return { ok: false, reason: 'not enough coins' };
  state.addItem(item.id, qty);
  return { ok: true, item: { ...item }, quantity: qty, cost };
}
