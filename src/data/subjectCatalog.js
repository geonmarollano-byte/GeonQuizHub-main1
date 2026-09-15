/**
 * GEON'S GAMEHUB - subjectCatalog.js
 * Documented subject/topic catalog. Each subject has SUBJECT 1 + SUBJECT 2
 * quiz paths, each path has exactly 80 levels/questions with the documented
 * topic distribution.
 */
import { GAME } from '../gameCore.js';

export const CATALOG = Object.freeze({
  MATH: Object.freeze([
    Object.freeze({ topic: 'Multiplication', count: 15 }),
    Object.freeze({ topic: 'Division', count: 15 }),
    Object.freeze({ topic: 'Addition', count: 15 }),
    Object.freeze({ topic: 'Subtraction', count: 15 }),
    Object.freeze({ topic: 'Problem Solving', count: 20 }),
  ]),
  SCIENCE: Object.freeze([
    Object.freeze({ topic: 'Solid, Liquid, Gas', count: 15 }),
    Object.freeze({ topic: 'Translational / Rotational Motions', count: 15 }),
    Object.freeze({ topic: "Pascal's Principles", count: 20 }),
    Object.freeze({ topic: "Archimedes' Principles", count: 15 }),
    Object.freeze({ topic: 'History', count: 15 }),
  ]),
  PSYCHOLOGY: Object.freeze([
    Object.freeze({ topic: 'Mind Manipulations', count: 20 }),
    Object.freeze({ topic: 'Self Resilience', count: 20 }),
    Object.freeze({ topic: 'Convince Others', count: 20 }),
    Object.freeze({ topic: 'How to Become Unstoppable', count: 20 }),
  ]),
  'TECH 1': Object.freeze([
    Object.freeze({ topic: 'System Unit and Its Components', count: 30 }),
    Object.freeze({ topic: 'OHS Guidelines and DMA Procedures', count: 20 }),
    Object.freeze({ topic: 'Assemble and Disassemble System Unit', count: 30 }),
  ]),
  'TECH 2': Object.freeze([
    Object.freeze({ topic: 'BIOS / CMOS / UEFI', count: 30 }),
    Object.freeze({ topic: 'Networking', count: 20 }),
    Object.freeze({ topic: 'Windows Installation', count: 20 }),
    Object.freeze({ topic: 'Safety Procedures', count: 10 }),
  ]),
});

export const SUBJECT_META = Object.freeze({
  MATH: { icon: '➗', blurb: 'Numbers, operations and problem solving.' },
  SCIENCE: { icon: '🧪', blurb: 'Matter, motion, principles and history of science.' },
  PSYCHOLOGY: { icon: '🧠', blurb: 'Mind skills, resilience and communication.' },
  'TECH 1': { icon: '🖥️', blurb: 'System unit, OHS and assembly.' },
  'TECH 2': { icon: '🌐', blurb: 'BIOS/UEFI, networking, Windows and safety.' },
});

export function isValidSubject(subject) {
  return GAME.SUBJECTS.includes(subject);
}

export function isValidQuizType(quizType) {
  return GAME.QUIZ_TYPES.includes(quizType);
}

export function topicsFor(subject) {
  return CATALOG[subject] || [];
}

/** Sum of documented counts for a subject path (must be 80). */
export function pathLength(subject) {
  return topicsFor(subject).reduce((sum, t) => sum + t.count, 0);
}

/** Which topic does a given level (1..80) belong to, in catalog order. */
export function topicForLevel(subject, level) {
  const lv = Number(level);
  let acc = 0;
  for (const t of topicsFor(subject)) {
    acc += t.count;
    if (lv <= acc) return t.topic;
  }
  return null;
}

/** Verify a question bank matches the documented distribution exactly. */
export function verifyDistribution(questions) {
  const errors = [];
  if (!Array.isArray(questions)) return ['question bank is not an array'];
  const counts = new Map();
  for (const q of questions) {
    const key = `${q.subject}|${q.quizType}|${q.topic}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const subject of GAME.SUBJECTS) {
    for (const quizType of GAME.QUIZ_TYPES) {
      for (const { topic, count } of topicsFor(subject)) {
        const got = counts.get(`${subject}|${quizType}|${topic}`) || 0;
        if (got !== count) {
          errors.push(`${subject}/${quizType}/${topic}: expected ${count}, found ${got}`);
        }
      }
      // level coverage 1..80
      const levels = questions
        .filter((q) => q.subject === subject && q.quizType === quizType)
        .map((q) => q.level)
        .sort((a, b) => a - b);
      for (let i = 0; i < GAME.LEVELS_PER_PATH; i += 1) {
        if (levels[i] !== i + 1) {
          errors.push(`${subject}/${quizType}: level coverage broken at position ${i + 1}`);
          break;
        }
      }
    }
  }
  return errors;
}
