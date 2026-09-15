/**
 * GEON'S GAMEHUB - sessionBuilder.js
 * Session construction boundary: builds an ordered quiz session for a path,
 * aligned to the selected starting level, and skipping questions already
 * used in the current run ("used-question tracking" from the blueprint).
 */
import { GAME } from '../gameCore.js';
import { pathQuestions } from '../data/questionLoader.js';

/**
 * @param {Array} questions   full bank for the active questioner
 * @param {string} subject
 * @param {string} quizType
 * @param {number} startLevel 1..80
 * @param {Set<string>|Array<string>} usedIds question ids already used this run
 */
export function buildSession({ questions, subject, quizType, startLevel, usedIds }) {
  const path = pathQuestions(questions, subject, quizType);
  if (!path.length) {
    return { subject, quizType, questions: [], startLevel: 1, error: 'no questions for this path' };
  }
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds || []);
  const level = Math.min(Math.max(Math.floor(Number(startLevel) || 1, 10), 1), GAME.LEVELS_PER_PATH);
  // Align session position with the selected level (blueprint step 8).
  const ordered = path.filter((q) => q.level >= level && !used.has(q.id));
  return {
    subject,
    quizType,
    questions: ordered,
    startLevel: level,
    pathLength: path.length,
    error: ordered.length ? null : 'every question in range was already used',
  };
}

/** Validate a level selection for a path given saved progression. */
export function validateLevelSelection(level, pass) {
  const lv = Math.floor(Number(level) || 0);
  if (!Number.isInteger(lv) || lv < 1 || lv > GAME.LEVELS_PER_PATH) return { ok: false, reason: 'invalid level' };
  const unlocked = Math.min(pass.completedLevels + 1, GAME.LEVELS_PER_PATH);
  if (lv > unlocked) return { ok: false, reason: 'level locked', unlocked };
  return { ok: true, level: lv };
}
