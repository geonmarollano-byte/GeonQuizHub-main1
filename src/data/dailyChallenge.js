/**
 * GEON'S GAMEHUB - dailyChallenge.js
 * Deterministic daily selection:
 *   DATE + QUESTIONER -> SEED -> HASH/RANK QUESTION IDS -> 10 QUESTIONS
 * The same date + questioner always produces the same 10 questions.
 * Reward claiming is guarded by a rewardClaimed flag in saved daily state.
 */
import { GAME } from '../gameCore.js';

/** FNV-1a 32-bit hash - small, stable, dependency-free. */
export function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function dailySeed(dateStr, questioner) {
  return fnv1a(`${dateStr}|${questioner}|geons-daily`);
}

/** Local YYYY-MM-DD (user's own timezone, so the "day" matches the player). */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyStateKey(dateStr, questioner) {
  return `${dateStr}::${questioner}`;
}

/**
 * Deterministic mulberry32 PRNG seeded from the daily seed.
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rank question ids by the seeded hash and select the daily set.
 * Selection is stable for a given (date, questioner) pair.
 */
export function selectDailyQuestions(questions, seed, count = GAME.DAILY_QUESTION_COUNT) {
  const ranked = questions
    .map((q) => ({ q, rank: fnv1a(`${q.id}::${seed}`) }))
    .sort((a, b) => a.rank - b.rank || (a.q.id < b.q.id ? -1 : 1));
  return ranked.slice(0, count).map((entry) => entry.q);
}

/**
 * Build today's daily challenge for a questioner.
 */
export function buildDaily(questions, questioner, dateStr = todayKey()) {
  const seed = dailySeed(dateStr, questioner);
  return {
    date: dateStr,
    questioner,
    seed,
    questions: selectDailyQuestions(questions, seed),
  };
}

/** Guarded reward claim: returns true only the first time. */
export function claimDailyReward(dailyState, key) {
  const entry = dailyState[key] || { completed: false, rewardClaimed: false, score: 0, correct: 0 };
  if (entry.rewardClaimed) return false;
  entry.rewardClaimed = true;
  dailyState[key] = entry;
  return true;
}
