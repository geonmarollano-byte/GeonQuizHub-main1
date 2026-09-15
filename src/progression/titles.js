/**
 * GEON'S GAMEHUB - titles.js
 * Title progression boundary. The blueprint documents that titles track
 * progression by completed levels; the exact ladder wording is an
 * implementation detail (documented in DESIGN_DECISIONS.md): titles advance
 * with total completed levels for the active questioner.
 */
export const TITLES = Object.freeze([
  Object.freeze({ min: 0, title: 'NOVICE', icon: '🌱' }),
  Object.freeze({ min: 10, title: 'APPRENTICE', icon: '📘' }),
  Object.freeze({ min: 25, title: 'SCHOLAR', icon: '🎓' }),
  Object.freeze({ min: 50, title: 'SPECIALIST', icon: '🧭' }),
  Object.freeze({ min: 100, title: 'EXPERT', icon: '⭐' }),
  Object.freeze({ min: 200, title: 'MASTER', icon: '🏅' }),
  Object.freeze({ min: 400, title: 'GRANDMASTER', icon: '👑' }),
  Object.freeze({ min: 800, title: "GEON'S CHAMPION", icon: '🏆' }),
]);

export function titleFor(totalCompletedLevels) {
  const n = Math.max(0, Math.floor(Number(totalCompletedLevels) || 0));
  let current = TITLES[0];
  for (const tier of TITLES) {
    if (n >= tier.min) current = tier;
  }
  return current;
}

export function nextTitle(totalCompletedLevels) {
  const n = Math.max(0, Math.floor(Number(totalCompletedLevels) || 0));
  return TITLES.find((t) => t.min > n) || null;
}
