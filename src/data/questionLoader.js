/**
 * GEON'S GAMEHUB - questionLoader.js
 * Question loading boundary: fetch the JSON banks over HTTP when available,
 * otherwise fall back to the embedded banks (offline / file:// usage).
 * Corrupted or partial data is filtered through the validator, never thrown.
 */
import { validateBank, safeQuestions } from './questionValidator.js';

export const BANK_FILES = Object.freeze({
  previous: 'questions.json',
  new: 'questions.new.json',
});

/** Read embedded bank from the window object (set by questions*.embedded.js). */
export function embeddedBank(questioner, globalObj) {
  const g = globalObj || (typeof window !== 'undefined' ? window : null);
  if (!g) return null;
  return questioner === 'new' ? g.GEON_QUESTIONS_NEW || null : g.GEON_QUESTIONS_PREVIOUS || null;
}

/**
 * Load one questioner's bank.
 * @param {object} opts
 *   questioner: 'previous' | 'new'
 *   fetchImpl:  optional fetch-compatible function (injected in tests)
 *   globalObj:  optional window-like object for embedded fallback
 * @returns {Promise<{questioner:string, questions:Array, source:string, warnings:string[]}>}
 */
export async function loadBank({ questioner, fetchImpl, globalObj } = {}) {
  const warnings = [];
  let doc = null;
  let source = 'none';
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (doFetch) {
    try {
      const res = await doFetch(BANK_FILES[questioner] || BANK_FILES.previous);
      if (res && res.ok) {
        doc = await res.json();
        source = 'json';
      } else {
        warnings.push(`HTTP fetch failed (${res && res.status}); using embedded bank.`);
      }
    } catch (err) {
      warnings.push(`fetch error (${err && err.message}); using embedded bank.`);
    }
  }
  if (!doc) {
    doc = embeddedBank(questioner, globalObj);
    source = doc ? 'embedded' : 'none';
  }
  const validation = doc ? validateBank(doc) : { ok: false, errors: ['no bank available'] };
  if (!validation.ok) {
    warnings.push(`bank validation issues: ${validation.errors.slice(0, 5).join(' | ')}`);
  }
  const questions = doc ? safeQuestions(doc.questions) : [];
  return { questioner, questions, source, warnings };
}

/** Index questions by "subject|quizType" for fast path lookups. */
export function indexByPath(questions) {
  const map = new Map();
  for (const q of questions) {
    const key = `${q.subject}|${q.quizType}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(q);
  }
  for (const list of map.values()) list.sort((a, b) => a.level - b.level);
  return map;
}

/** Get one quiz path's questions (levels 1..80 in order). */
export function pathQuestions(questions, subject, quizType) {
  return questions
    .filter((q) => q.subject === subject && q.quizType === quizType)
    .sort((a, b) => a.level - b.level);
}
