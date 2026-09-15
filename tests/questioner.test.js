/**
 * GEON'S GAMEHUB - tests/questioner.test.js
 * Previous/New questioner datasets and progress separation:
 * - both banks load from the real JSON files
 * - 800 records each, documented distributions, unique ids, valid answers
 * - progress keys are separated by questioner and never overwrite each other
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { GAME, passKey } from '../src/gameCore.js';
import { validateBank } from '../src/data/questionValidator.js';
import { verifyDistribution, CATALOG, topicForLevel } from '../src/data/subjectCatalog.js';
import { GameState } from '../src/state/gameState.js';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';
import { loadBank, pathQuestions } from '../src/data/questionLoader.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const prevDoc = JSON.parse(readFileSync(path.join(root, 'questions.json'), 'utf8'));
const newDoc = JSON.parse(readFileSync(path.join(root, 'questions.new.json'), 'utf8'));

test('both questioner banks are complete and valid', () => {
  for (const [name, doc] of [['previous', prevDoc], ['new', newDoc]]) {
    assert.equal(doc.questioner, name, `${name}: questioner marker`);
    assert.equal(doc.questions.length, 800, `${name}: expected 800 records`);
    const result = validateBank(doc);
    assert.deepEqual(result.errors.slice(0, 3), [], `${name}: validation errors`);
    const distErrors = verifyDistribution(doc.questions);
    assert.deepEqual(distErrors.slice(0, 3), [], `${name}: distribution errors`);
  }
});

test('every quiz path has exactly 80 levels, levels 1..80', () => {
  for (const doc of [prevDoc, newDoc]) {
    for (const subject of GAME.SUBJECTS) {
      for (const quizType of GAME.QUIZ_TYPES) {
        const pathQ = pathQuestions(doc.questions, subject, quizType);
        assert.equal(pathQ.length, 80, `${doc.questioner} ${subject}/${quizType}`);
        pathQ.forEach((q, i) => assert.equal(q.level, i + 1));
      }
    }
  }
});

test('topic distribution matches the blueprint for every path', () => {
  for (const doc of [prevDoc, newDoc]) {
    for (const subject of GAME.SUBJECTS) {
      for (const { topic, count } of CATALOG[subject]) {
        for (const quizType of GAME.QUIZ_TYPES) {
          const n = doc.questions.filter(
            (q) => q.subject === subject && q.quizType === quizType && q.topic === topic
          ).length;
          assert.equal(n, count, `${doc.questioner} ${subject}/${quizType}/${topic}`);
        }
      }
    }
  }
});

test('levels map to the documented topic order', () => {
  assert.equal(topicForLevel('MATH', 1), 'Multiplication');
  assert.equal(topicForLevel('MATH', 16), 'Division');
  assert.equal(topicForLevel('MATH', 61), 'Problem Solving');
  assert.equal(topicForLevel('SCIENCE', 31), "Pascal's Principles");
  assert.equal(topicForLevel('PSYCHOLOGY', 61), 'How to Become Unstoppable');
  assert.equal(topicForLevel('TECH 1', 31), 'OHS Guidelines and DMA Procedures');
  assert.equal(topicForLevel('TECH 2', 71), 'Safety Procedures');
});

test('the two questioners are distinct datasets', () => {
  assert.notEqual(prevDoc.questions[0].id, newDoc.questions[0].id);
  const prevIds = new Set(prevDoc.questions.map((q) => q.id));
  for (const q of newDoc.questions) assert.equal(prevIds.has(q.id), false, `id collision: ${q.id}`);
  // Fact/word-problem content must be largely distinct. Bare arithmetic
  // identities (e.g. "What is 3 x 10?") are universal facts and may appear in
  // both banks, so measure overlap on the worded questions only.
  const worded = (q) => !/^What is [\d\s+\-x/]+[?.]$/.test(q.question);
  const prevWorded = new Set(prevDoc.questions.filter(worded).map((q) => q.question));
  const newWorded = newDoc.questions.filter(worded);
  const overlap = newWorded.filter((q) => prevWorded.has(q.question)).length;
  const rate = overlap / newWorded.length;
  assert.ok(rate < 0.3, `worded-question overlap between questioners too high: ${(rate * 100).toFixed(1)}%`);
});

test('progress is stored separately per questioner', () => {
  const state = new GameState(new GeonStorage({ backend: memoryBackend() }));
  // advance PREVIOUS progress
  state.recordLevelComplete('previous', 'MATH', 'SUBJECT 1', 1, 50);
  state.recordLevelComplete('previous', 'MATH', 'SUBJECT 1', 2, 120);
  // advance NEW progress independently
  state.recordLevelComplete('new', 'MATH', 'SUBJECT 1', 1, 80);

  const prevPass = state.getPass('previous', 'MATH', 'SUBJECT 1');
  const newPass = state.getPass('new', 'MATH', 'SUBJECT 1');
  assert.equal(prevPass.completedLevels, 2);
  assert.equal(prevPass.bestScore, 120);
  assert.equal(newPass.completedLevels, 1);
  assert.equal(newPass.bestScore, 80);

  // persist + reload: separation survives
  state.save();
  const reloaded = new GameState(state.storage);
  assert.equal(reloaded.getPass('previous', 'MATH', 'SUBJECT 1').completedLevels, 2);
  assert.equal(reloaded.getPass('new', 'MATH', 'SUBJECT 1').completedLevels, 1);

  // resetting one questioner's pass never touches the other
  reloaded.resetPass('new', 'MATH', 'SUBJECT 1');
  assert.equal(reloaded.getPass('previous', 'MATH', 'SUBJECT 1').completedLevels, 2);
  assert.equal(reloaded.getPass('new', 'MATH', 'SUBJECT 1').completedLevels, 0);
});

test('statistics are tracked separately per questioner', () => {
  const state = new GameState(new GeonStorage({ backend: memoryBackend() }));
  state.recordAnswer('previous', 'SCIENCE', true);
  state.recordAnswer('new', 'SCIENCE', false);
  state.recordAnswer('new', 'SCIENCE', false);
  assert.equal(state.stats.previous.SCIENCE.correct, 1);
  assert.equal(state.stats.previous.SCIENCE.wrong, 0);
  assert.equal(state.stats.new.SCIENCE.wrong, 2);
  assert.equal(state.stats.new.SCIENCE.correct, 0);
});

test('loadBank falls back to embedded data when fetch fails', async () => {
  const failingFetch = async () => {
    throw new Error('offline');
  };
  const fakeWindow = {
    GEON_QUESTIONS_PREVIOUS: prevDoc,
    GEON_QUESTIONS_NEW: newDoc,
  };
  const prev = await loadBank({ questioner: 'previous', fetchImpl: failingFetch, globalObj: fakeWindow });
  assert.equal(prev.source, 'embedded');
  assert.equal(prev.questions.length, 800);
  const next = await loadBank({ questioner: 'new', fetchImpl: failingFetch, globalObj: fakeWindow });
  assert.equal(next.source, 'embedded');
  assert.equal(next.questions.length, 800);
});

test('loadBank filters invalid records instead of crashing', async () => {
  const fakeWindow = {
    GEON_QUESTIONS_PREVIOUS: {
      questioner: 'previous',
      questions: [
        ...prevDoc.questions.slice(0, 5),
        { id: 'bad-1', subject: 'NOPE', quizType: 'SUBJECT 1', level: 1, question: '', choices: ['a'], answer: 'zzz' },
      ],
    },
  };
  const res = await loadBank({ questioner: 'previous', fetchImpl: null, globalObj: fakeWindow });
  assert.equal(res.questions.length, 5);
  assert.ok(res.warnings.length > 0);
});
