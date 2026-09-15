/**
 * GEON'S GAMEHUB - scoring.js
 * Scoring boundary: computes per-answer rewards from the documented bands,
 * streak multipliers and streak milestone bonuses. Pure functions only.
 */
import { rewardBandForLevel, multiplierForStreak, milestoneForStreak } from '../gameCore.js';

/**
 * Reward for one correct answer.
 * @param {number} level   current level (1..80) - decides the reward band
 * @param {number} streak  streak AFTER this correct answer (>=1)
 * @returns {{score:number, coins:number, points:number, band:object, multiplier:number, milestone:object|null}}
 */
export function computeAnswerReward(level, streak) {
  const band = rewardBandForLevel(level);
  const multiplier = multiplierForStreak(streak);
  const milestone = milestoneForStreak(streak);
  const baseScore = Math.round(band.score * multiplier);
  const score = baseScore + (milestone ? milestone.score : 0);
  const coins = band.coins + (milestone ? milestone.coins : 0);
  const points = band.points + (milestone ? milestone.points : 0);
  return { score, coins, points, band, multiplier, milestone };
}

/** Reward table row for display purposes. */
export function rewardTable() {
  return [
    { range: '1-20', score: 50, coins: 5, points: 10 },
    { range: '21-40', score: 100, coins: 10, points: 20 },
    { range: '41-60', score: 175, coins: 15, points: 35 },
    { range: '61-80', score: 300, coins: 25, points: 60 },
  ];
}
