/**
 * GEON'S GAMEHUB - questionValidator.js
 * Validates question data so corrupted banks can never crash the game.
 * Checks (per blueprint): id presence, valid subject, valid quiz type,
 * valid level, non-empty question, valid choices, answer contained in choices.
 */
import { GAME } from '../gameCore.js';

export function validateQuestion(q) {
  const errors = [];
  if (!q || typeof q !== 'object') return ['question is not an object'];
  if (typeof q.id !== 'string' || !q.id.trim()) errors.push('missing id');
  if (!GAME.SUBJECTS.includes(q.subject)) errors.push(`invalid subject: ${q.subject}`);
  if (!GAME.QUIZ_TYPES.includes(q.quizType)) errors.push(`invalid quizType: ${q.quizType}`);
  const level = Number(q.level);
  if (!Number.isInteger(level) || level < 1 || level > GAME.LEVELS_PER_PATH) {
    errors.push(`invalid level: ${q.level}`);
  }
  if (typeof q.question !== 'string' || !q.question.trim()) errors.push('empty question text');
  if (!Array.isArray(q.choices) || q.choices.length < 2) {
    errors.push('choices must be an array with at least 2 entries');
  } else {
    if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) errors.push('blank choice present');
    if (new Set(q.choices).size !== q.choices.length) errors.push('duplicate choices');
    if (typeof q.answer !== 'string' || !q.choices.includes(q.answer)) {
      errors.push('answer is not contained in choices');
    }
  }
  return errors;
}

export function validateBank(doc) {
  const result = { ok: false, errors: [], questionCount: 0 };
  if (!doc || typeof doc !== 'object') {
    result.errors.push('bank document is missing');
    return result;
  }
  if (!GAME.QUESTIONERS.includes(doc.questioner)) {
    result.errors.push(`invalid questioner: ${doc && doc.questioner}`);
  }
  if (!Array.isArray(doc.questions)) {
    result.errors.push('questions array missing');
    return result;
  }
  const seenIds = new Set();
  doc.questions.forEach((q, i) => {
    const errors = validateQuestion(q);
    if (errors.length) result.errors.push(`question[${i}] (${q && q.id}): ${errors.join('; ')}`);
    if (q && typeof q.id === 'string') {
      if (seenIds.has(q.id)) result.errors.push(`duplicate id: ${q.id}`);
      seenIds.add(q.id);
    }
  });
  result.questionCount = doc.questions.length;
  result.ok = result.errors.length === 0;
  return result;
}

/** Filter a raw array down to only usable questions (never throws). */
export function safeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((q) => validateQuestion(q).length === 0);
}
