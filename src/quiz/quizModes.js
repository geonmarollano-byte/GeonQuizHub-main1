/**
 * GEON'S GAMEHUB - quizModes.js
 * Quiz mode boundary: mode-specific configuration for Normal Quiz, Daily
 * Challenge and Reviewer Mode (each has its own documented handling).
 */
import { GAME } from '../gameCore.js';

export const MODES = Object.freeze({
  normal: Object.freeze({
    id: 'normal',
    label: 'Normal Quiz',
    lives: GAME.START_LIVES,
    secondsPerQuestion: GAME.QUESTION_SECONDS,
    timed: true,
    levelProgression: true,
    rewards: true,
    victoryAtLevel: GAME.LEVELS_PER_PATH,
  }),
  daily: Object.freeze({
    id: 'daily',
    label: 'Daily Challenge',
    lives: GAME.START_LIVES,
    secondsPerQuestion: GAME.QUESTION_SECONDS,
    timed: true,
    levelProgression: false,
    rewards: true,
    questionCount: GAME.DAILY_QUESTION_COUNT,
  }),
  reviewer: Object.freeze({
    id: 'reviewer',
    label: 'Reviewer Mode',
    lives: Infinity, // practice mode - no lives
    secondsPerQuestion: 0,
    timed: false, // practice mode - no pressure
    levelProgression: false,
    rewards: false, // no coins/points/progress - practice only
    questionCount: GAME.REVIEWER_ROUND_SIZE,
  }),
});

export function getMode(id) {
  return MODES[id] || MODES.normal;
}
