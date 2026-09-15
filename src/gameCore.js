/**
 * GEON'S GAMEHUB - gameCore.js
 * Core rules, constants, validation and sanitization.
 * Blueprint: 8 lives, 30s timer, 80 levels/path, reward bands, streak
 * multipliers, streak milestones, shop items, points->coins conversion.
 * This module is DOM-free so it can run in the browser and in Node tests.
 */

export const GAME = Object.freeze({
  SUBJECTS: Object.freeze(['MATH', 'SCIENCE', 'PSYCHOLOGY', 'TECH 1', 'TECH 2']),
  QUIZ_TYPES: Object.freeze(['SUBJECT 1', 'SUBJECT 2']),
  QUESTIONERS: Object.freeze(['previous', 'new']),
  LEVELS_PER_PATH: 80,
  START_LIVES: 8,
  MAX_LIVES: 8,
  QUESTION_SECONDS: 30,
  TIME_BOOST_SECONDS: 10,
  SPEED_ANSWER_SECONDS: 5,
  DAILY_QUESTION_COUNT: 10,
  REVIEWER_ROUND_SIZE: 10,
  MISSION_COUNT: 5,
  SCHEMA_VERSION: 2,
  STORAGE_PREFIX: 'geonshub',
  // Points -> Coins conversion (implementation detail, documented):
  // rate is 2 points = 1 coin, converted in blocks of 10 points.
  CONVERT_POINTS_BLOCK: 10,
  CONVERT_COINS_BLOCK: 5,
});

/** Documented reward bands by level range (score / coins / points per correct answer). */
export const REWARD_BANDS = Object.freeze([
  Object.freeze({ min: 1, max: 20, score: 50, coins: 5, points: 10 }),
  Object.freeze({ min: 21, max: 40, score: 100, coins: 10, points: 20 }),
  Object.freeze({ min: 41, max: 60, score: 175, coins: 15, points: 35 }),
  Object.freeze({ min: 61, max: 80, score: 300, coins: 25, points: 60 }),
]);

/** Documented streak score multipliers. */
export const STREAK_MULTIPLIERS = Object.freeze([
  Object.freeze({ min: 1, max: 2, mult: 1 }),
  Object.freeze({ min: 3, max: 4, mult: 1.2 }),
  Object.freeze({ min: 5, max: 9, mult: 1.5 }),
  Object.freeze({ min: 10, max: 14, mult: 2 }),
  Object.freeze({ min: 15, max: 19, mult: 2.5 }),
  Object.freeze({ min: 20, max: Infinity, mult: 3 }),
]);

/** Documented streak milestone bonuses. */
export const STREAK_MILESTONES = Object.freeze({
  3: Object.freeze({ name: 'HOT START', score: 25, coins: 0, points: 0 }),
  5: Object.freeze({ name: 'ON FIRE', score: 50, coins: 5, points: 0 }),
  10: Object.freeze({ name: 'UNSTOPPABLE', score: 100, coins: 10, points: 10 }),
  15: Object.freeze({ name: 'QUIZ MASTER', score: 150, coins: 15, points: 15 }),
  20: Object.freeze({ name: 'LEGENDARY STREAK', score: 250, coins: 25, points: 25 }),
});

/** Documented usable shop items. */
export const SHOP_ITEMS = Object.freeze([
  Object.freeze({ id: 'life_token', name: 'Life Token', price: 100, description: '+1 life (never above the normal maximum of 8).' }),
  Object.freeze({ id: 'time_boost', name: 'Time Boost', price: 75, description: 'Adds +10 seconds to the current question timer.' }),
  Object.freeze({ id: 'hint', name: 'Hint', price: 100, description: 'Reveals a clue for the current question.' }),
  Object.freeze({ id: 'fifty_fifty', name: '50/50', price: 150, description: 'Removes two incorrect choices, leaving the answer and one distractor.' }),
  Object.freeze({ id: 'second_chance', name: 'Second Chance', price: 200, description: 'Retry the question after a wrong answer without losing a life.' }),
]);

/** Story rewards (documented). */
export const STORY_REWARDS = Object.freeze({
  complete: Object.freeze({ points: 75, coins: 15 }),
  perfect: Object.freeze({ points: 50, coins: 10 }),
  allComplete: Object.freeze({ points: 200, coins: 50 }),
});

/** Mission rewards (documented). */
export const MISSION_REWARDS = Object.freeze({
  perMission: Object.freeze({ points: 100, coins: 20 }),
  allComplete: Object.freeze({ points: 250, coins: 75 }),
});

/** Daily challenge reward (documented). */
export const DAILY_REWARD = Object.freeze({ points: 100, coins: 5 });

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------
export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Coerce to a safe non-negative integer with a hard cap (anti-corruption). */
export function sanitizeCount(value, cap = 1000000) {
  const n = toInt(value, 0);
  return clamp(n, 0, cap);
}

export function sanitizeString(value, fallback = '', maxLen = 500) {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Rule lookups
// ---------------------------------------------------------------------------
export function rewardBandForLevel(level) {
  const lv = toInt(level, 1);
  return REWARD_BANDS.find((b) => lv >= b.min && lv <= b.max) || REWARD_BANDS[0];
}

export function multiplierForStreak(streak) {
  const s = toInt(streak, 0);
  const band = STREAK_MULTIPLIERS.find((b) => s >= b.min && s <= b.max);
  return band ? band.mult : 1;
}

export function milestoneForStreak(streak) {
  return STREAK_MILESTONES[String(toInt(streak, 0))] || null;
}

export function shopItemById(id) {
  return SHOP_ITEMS.find((i) => i.id === id) || null;
}

/** Stable key identifying one quiz path. */
export function passKey(subject, quizType) {
  return `${sanitizeString(subject)}|${sanitizeString(quizType)}`;
}

// ---------------------------------------------------------------------------
// Sanitizers (protect the game from corrupted saved data)
// ---------------------------------------------------------------------------
export function sanitizeSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  const theme = ['original', 'light', 'dark'].includes(v.theme) ? v.theme : 'original';
  const questioner = GAME.QUESTIONERS.includes(v.questioner) ? v.questioner : 'previous';
  return {
    music: v.music !== false,
    sound: v.sound !== false,
    reader: v.reader === true,
    questioner,
    theme,
  };
}

export function sanitizeProfile(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    name: sanitizeString(v.name, 'Player', 24) || 'Player',
    code: sanitizeString(v.code, 'GEON-0001', 16) || 'GEON-0001',
    avatar: sanitizeString(v.avatar, '🦁', 8) || '🦁',
  };
}

export function sanitizeEconomy(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    coins: sanitizeCount(v.coins),
    points: sanitizeCount(v.points),
    totalCoinsEarned: sanitizeCount(v.totalCoinsEarned),
    totalPointsEarned: sanitizeCount(v.totalPointsEarned),
  };
}

export function sanitizeInventory(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const item of SHOP_ITEMS) {
    out[item.id] = sanitizeCount(v[item.id], 999);
  }
  return out;
}

/** One pass of saved progress. */
function sanitizePass(value) {
  const v = value && typeof value === 'object' ? value : {};
  const highest = clamp(toInt(v.highestLevel, 1), 1, GAME.LEVELS_PER_PATH);
  const completed = clamp(toInt(v.completedLevels, 0), 0, GAME.LEVELS_PER_PATH);
  return {
    highestLevel: highest,
    completedLevels: completed,
    bestScore: sanitizeCount(v.bestScore, 10 ** 9),
  };
}

/**
 * Progress is stored SEPARATELY per questioner:
 * { previous: { "MATH|SUBJECT 1": {...}, ... }, new: { ... } }
 * Unknown questioners/keys are dropped instead of merged.
 */
export function sanitizeProgress(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const q of GAME.QUESTIONERS) {
    out[q] = {};
    const table = v[q] && typeof v[q] === 'object' ? v[q] : {};
    for (const subject of GAME.SUBJECTS) {
      for (const quiz of GAME.QUIZ_TYPES) {
        const key = passKey(subject, quiz);
        if (table[key]) out[q][key] = sanitizePass(table[key]);
      }
    }
  }
  return out;
}

export function sanitizeStats(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const q of GAME.QUESTIONERS) {
    out[q] = {};
    const table = v[q] && typeof v[q] === 'object' ? v[q] : {};
    for (const subject of GAME.SUBJECTS) {
      const s = table[subject] && typeof table[subject] === 'object' ? table[subject] : {};
      out[q][subject] = {
        plays: sanitizeCount(s.plays),
        correct: sanitizeCount(s.correct),
        wrong: sanitizeCount(s.wrong),
        bestScore: sanitizeCount(s.bestScore, 10 ** 9),
        bestStreak: sanitizeCount(s.bestStreak, 10 ** 6),
        reviewed: sanitizeCount(s.reviewed),
      };
    }
  }
  return out;
}

export function sanitizeAchievements(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const [id, ts] of Object.entries(v)) {
    if (typeof id === 'string' && id.length <= 64) {
      out[id] = sanitizeCount(ts, 10 ** 13) || Date.now();
    }
  }
  return out;
}

export function sanitizeDaily(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const [key, entry] of Object.entries(v)) {
    if (typeof key !== 'string' || key.length > 64) continue;
    const e = entry && typeof entry === 'object' ? entry : {};
    out[key] = {
      completed: e.completed === true,
      rewardClaimed: e.rewardClaimed === true,
      score: sanitizeCount(e.score, 10 ** 9),
      correct: sanitizeCount(e.correct, GAME.DAILY_QUESTION_COUNT),
    };
  }
  return out;
}

export function sanitizeStoryProgress(value) {
  const v = value && typeof value === 'object' ? value : {};
  const completed = {};
  const src = v.completed && typeof v.completed === 'object' ? v.completed : {};
  for (const [id, entry] of Object.entries(src)) {
    if (typeof id !== 'string' || id.length > 64) continue;
    const e = entry && typeof entry === 'object' ? entry : {};
    completed[id] = {
      baseClaimed: e.baseClaimed === true,
      perfectClaimed: e.perfectClaimed === true,
      correct: sanitizeCount(e.correct, 100),
      total: sanitizeCount(e.total, 100),
    };
  }
  return {
    completed,
    allClaimed: v.allClaimed === true,
  };
}

export function sanitizeLeaderboard(value) {
  const v = Array.isArray(value) ? value : [];
  return v
    .slice(0, 50)
    .map((entry) => ({
      name: sanitizeString(entry && entry.name, 'Player', 24),
      subject: GAME.SUBJECTS.includes(entry && entry.subject) ? entry.subject : 'OVERALL',
      score: sanitizeCount(entry && entry.score, 10 ** 9),
      correct: sanitizeCount(entry && entry.correct, 10000),
      total: sanitizeCount(entry && entry.total, 10000),
      when: sanitizeCount(entry && entry.when, 10 ** 13),
    }))
    .filter((e) => e.total > 0 || e.score > 0);
}
