/**
 * GEON'S GAMEHUB - gameState.js
 * Single GameState model (blueprint Phase 2: "Move all global state into a
 * single GameState model"). Everything persists through GeonStorage and is
 * sanitized on load, so corrupted saves degrade to safe defaults.
 *
 * Progress and statistics are stored SEPARATELY per questioner
 * (previous / new) - the New dataset can never overwrite Previous progress.
 */
import {
  GAME,
  passKey,
  sanitizeProfile,
  sanitizeEconomy,
  sanitizeInventory,
  sanitizeProgress,
  sanitizeStats,
  sanitizeAchievements,
  sanitizeDaily,
  sanitizeStoryProgress,
  sanitizeLeaderboard,
  clamp,
} from '../gameCore.js';

export const KEYS = Object.freeze({
  profile: 'profile',
  economy: 'economy',
  inventory: 'inventory',
  progress: 'progress',
  stats: 'stats',
  achievements: 'achievements',
  daily: 'daily',
  story: 'story',
  leaderboard: 'leaderboard',
  missions: 'missions',
});

export class GameState {
  constructor(storage) {
    this.storage = storage;
    this.profile = sanitizeProfile(storage ? storage.get(KEYS.profile, null) : null);
    this.economy = sanitizeEconomy(storage ? storage.get(KEYS.economy, null) : null);
    this.inventory = sanitizeInventory(storage ? storage.get(KEYS.inventory, null) : null);
    this.progress = sanitizeProgress(storage ? storage.get(KEYS.progress, null) : null);
    this.stats = sanitizeStats(storage ? storage.get(KEYS.stats, null) : null);
    this.achievements = sanitizeAchievements(storage ? storage.get(KEYS.achievements, null) : null);
    this.daily = sanitizeDaily(storage ? storage.get(KEYS.daily, null) : null);
    this.story = sanitizeStoryProgress(storage ? storage.get(KEYS.story, null) : null);
    this.leaderboard = sanitizeLeaderboard(storage ? storage.get(KEYS.leaderboard, null) : null);
    this.missions = this._sanitizeMissions(storage ? storage.get(KEYS.missions, null) : null);
  }

  _sanitizeMissions(value) {
    const v = value && typeof value === 'object' ? value : {};
    return {
      runsCompleted: Math.max(0, Math.min(100000, Number.parseInt(v.runsCompleted, 10) || 0)),
      missionsCompleted: Math.max(0, Math.min(1000000, Number.parseInt(v.missionsCompleted, 10) || 0)),
      lastRun: typeof v.lastRun === 'string' ? v.lastRun.slice(0, 64) : '',
    };
  }

  save() {
    if (!this.storage) return;
    this.storage.set(KEYS.profile, this.profile);
    this.storage.set(KEYS.economy, this.economy);
    this.storage.set(KEYS.inventory, this.inventory);
    this.storage.set(KEYS.progress, this.progress);
    this.storage.set(KEYS.stats, this.stats);
    this.storage.set(KEYS.achievements, this.achievements);
    this.storage.set(KEYS.daily, this.daily);
    this.storage.set(KEYS.story, this.story);
    this.storage.set(KEYS.leaderboard, this.leaderboard);
    this.storage.set(KEYS.missions, this.missions);
  }

  // ---------------- economy ----------------
  addCoins(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    this.economy.coins += n;
    this.economy.totalCoinsEarned += n;
    return n;
  }

  addPoints(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    this.economy.points += n;
    this.economy.totalPointsEarned += n;
    return n;
  }

  spendCoins(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (this.economy.coins < n) return false;
    this.economy.coins -= n;
    return true;
  }

  spendPoints(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (this.economy.points < n) return false;
    this.economy.points -= n;
    return true;
  }

  /** Points -> Coins conversion (documented economy bridge). */
  convertPointsToCoins(blocks) {
    const b = clamp(Math.floor(Number(blocks) || 0), 0, 10000);
    const pointsCost = b * GAME.CONVERT_POINTS_BLOCK;
    if (b <= 0 || this.economy.points < pointsCost) return { ok: false, coins: 0 };
    this.economy.points -= pointsCost;
    const coins = b * GAME.CONVERT_COINS_BLOCK;
    this.economy.coins += coins;
    this.economy.totalCoinsEarned += coins;
    return { ok: true, coins, pointsSpent: pointsCost };
  }

  // ---------------- inventory ----------------
  addItem(id, amount = 1) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    this.inventory[id] = clamp((this.inventory[id] || 0) + n, 0, 999);
    return this.inventory[id];
  }

  useItem(id) {
    if ((this.inventory[id] || 0) <= 0) return false;
    this.inventory[id] -= 1;
    return true;
  }

  itemCount(id) {
    return this.inventory[id] || 0;
  }

  // ---------------- progression (per questioner) ----------------
  getPass(questioner, subject, quizType) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    const table = this.progress[q];
    const key = passKey(subject, quizType);
    if (!table[key]) {
      table[key] = { highestLevel: 1, completedLevels: 0, bestScore: 0 };
    }
    return table[key];
  }

  /**
   * Record one completed level for a pass. Rewards were already applied by the
   * caller; this only touches progression bookkeeping (no reward duplication).
   */
  recordLevelComplete(questioner, subject, quizType, level, runScore) {
    const pass = this.getPass(questioner, subject, quizType);
    const lv = clamp(Math.floor(Number(level) || 1), 1, GAME.LEVELS_PER_PATH);
    if (lv === pass.completedLevels + 1) {
      pass.completedLevels = lv;
    }
    pass.highestLevel = clamp(Math.max(pass.highestLevel, Math.min(lv + 1, GAME.LEVELS_PER_PATH)), 1, GAME.LEVELS_PER_PATH);
    if (runScore > pass.bestScore) pass.bestScore = Math.floor(runScore);
    return pass;
  }

  /** Blueprint Game Over behavior: reset the pass toward Level 1. */
  resetPass(questioner, subject, quizType) {
    const pass = this.getPass(questioner, subject, quizType);
    pass.highestLevel = 1;
    pass.completedLevels = 0;
    pass.bestScore = 0;
    return pass;
  }

  totalCompletedLevels(questioner) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    return Object.values(this.progress[q]).reduce((sum, p) => sum + p.completedLevels, 0);
  }

  subjectCompletedLevels(questioner, subject) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    return GAME.QUIZ_TYPES.reduce(
      (sum, quiz) => sum + (this.progress[q][passKey(subject, quiz)]?.completedLevels || 0),
      0
    );
  }

  // ---------------- statistics (per questioner) ----------------
  recordAnswer(questioner, subject, correct) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    const s = this.stats[q][subject];
    if (!s) return;
    if (correct) s.correct += 1;
    else s.wrong += 1;
  }

  recordPlay(questioner, subject, score, bestStreak) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    const s = this.stats[q][subject];
    if (!s) return;
    s.plays += 1;
    if (score > s.bestScore) s.bestScore = Math.floor(score);
    if (bestStreak > s.bestStreak) s.bestStreak = Math.floor(bestStreak);
  }

  recordReview(questioner, subject, count = 1) {
    const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
    const s = this.stats[q][subject];
    if (s) s.reviewed += Math.max(0, Math.floor(count) || 0);
  }

  // ---------------- achievements ----------------
  hasAchievement(id) {
    return Boolean(this.achievements[id]);
  }

  unlockAchievement(id) {
    if (this.achievements[id]) return false;
    this.achievements[id] = Date.now();
    return true;
  }

  // ---------------- leaderboard ----------------
  submitScore(entry) {
    this.leaderboard.push({
      name: String(entry.name || this.profile.name).slice(0, 24),
      subject: GAME.SUBJECTS.includes(entry.subject) ? entry.subject : 'OVERALL',
      score: Math.max(0, Math.floor(Number(entry.score) || 0)),
      correct: Math.max(0, Math.floor(Number(entry.correct) || 0)),
      total: Math.max(0, Math.floor(Number(entry.total) || 0)),
      when: Date.now(),
    });
    this.leaderboard.sort((a, b) => b.score - a.score);
    this.leaderboard = this.leaderboard.slice(0, 20);
  }
}
