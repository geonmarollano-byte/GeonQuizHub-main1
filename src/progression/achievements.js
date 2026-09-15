/**
 * GEON'S GAMEHUB - achievements.js
 * Achievement boundary. Documented achievements:
 *   STREAK MASTER (10 consecutive correct), PERFECT LEVEL, SURVIVOR,
 *   SPEED QUIZZER (answer within 5s), <SUBJECT> COMPLETED x5,
 *   1,000-point milestone, 100-coin milestone.
 * Unlocks are idempotent: an achievement fires its presentation only once.
 */
import { GAME } from '../gameCore.js';

export const ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id: 'streak_master', name: 'STREAK MASTER', description: 'Answer 10 questions correctly in a row.', icon: '🔥' }),
  Object.freeze({ id: 'perfect_level', name: 'PERFECT LEVEL', description: 'Complete a level without any wrong answer.', icon: '💯' }),
  Object.freeze({ id: 'survivor', name: 'SURVIVOR', description: 'Finish a run of 5+ levels without reaching zero lives.', icon: '🛡️' }),
  Object.freeze({ id: 'speed_quizzer', name: 'SPEED QUIZZER', description: 'Answer a question correctly within 5 seconds.', icon: '⚡' }),
  Object.freeze({ id: 'math_completed', name: 'MATH COMPLETED', description: 'Complete every MATH level (both quiz types).', icon: '➗' }),
  Object.freeze({ id: 'science_completed', name: 'SCIENCE COMPLETED', description: 'Complete every SCIENCE level (both quiz types).', icon: '🧪' }),
  Object.freeze({ id: 'psychology_completed', name: 'PSYCHOLOGY COMPLETED', description: 'Complete every PSYCHOLOGY level (both quiz types).', icon: '🧠' }),
  Object.freeze({ id: 'tech1_completed', name: 'TECH 1 COMPLETED', description: 'Complete every TECH 1 level (both quiz types).', icon: '🖥️' }),
  Object.freeze({ id: 'tech2_completed', name: 'TECH 2 COMPLETED', description: 'Complete every TECH 2 level (both quiz types).', icon: '🌐' }),
  Object.freeze({ id: 'points_1000', name: 'POINT COLLECTOR', description: 'Earn 1,000 lifetime points.', icon: '🎯' }),
  Object.freeze({ id: 'coins_100', name: 'COIN SAVER', description: 'Earn 100 lifetime coins.', icon: '🪙' }),
]);

const SUBJECT_ACHIEVEMENT = {
  MATH: 'math_completed',
  SCIENCE: 'science_completed',
  PSYCHOLOGY: 'psychology_completed',
  'TECH 1': 'tech1_completed',
  'TECH 2': 'tech2_completed',
};

export function byId(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

/**
 * Evaluate state + the latest run summary; returns newly unlocked
 * achievements (presentation list). Never double-unlocks.
 */
export function evaluate(state, questioner, summary) {
  const newly = [];
  const unlock = (id) => {
    if (state.unlockAchievement(id)) newly.push(byId(id));
  };

  if (summary) {
    if (summary.bestStreak >= 10) unlock('streak_master');
    if (summary.perfectRun && summary.levelsCompleted >= 1) unlock('perfect_level');
    if (summary.survivedRun && summary.levelsCompleted >= 5) unlock('survivor');
    if (summary.speedHit) unlock('speed_quizzer');
    if (summary.subject && SUBJECT_ACHIEVEMENT[summary.subject]) {
      const needed = GAME.LEVELS_PER_PATH * GAME.QUIZ_TYPES.length; // 160
      if (state.subjectCompletedLevels(questioner, summary.subject) >= needed) {
        unlock(SUBJECT_ACHIEVEMENT[summary.subject]);
      }
    }
  }
  if (state.economy.totalPointsEarned >= 1000) unlock('points_1000');
  if (state.economy.totalCoinsEarned >= 100) unlock('coins_100');
  return newly.filter(Boolean);
}

/** 5-level milestone presentation (blueprint: every five completed levels). */
export function levelMilestoneLabel(level) {
  return level % 5 === 0 ? `LEVEL ${level} MILESTONE` : null;
}
