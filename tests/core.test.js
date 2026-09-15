/**
 * GEON'S GAMEHUB - tests/core.test.js
 * Core rules: reward bands, streak multipliers/milestones, shop prices,
 * sanitizers, scoring, timer, session building and quiz engine behavior.
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAME,
  REWARD_BANDS,
  STREAK_MULTIPLIERS,
  SHOP_ITEMS,
  rewardBandForLevel,
  multiplierForStreak,
  milestoneForStreak,
  sanitizeSettings,
  sanitizeProgress,
  sanitizeEconomy,
  passKey,
} from '../src/gameCore.js';
import { computeAnswerReward } from '../src/quiz/scoring.js';
import { QuizTimer } from '../src/quiz/timer.js';
import { buildSession, validateLevelSelection } from '../src/quiz/sessionBuilder.js';
import { QuizEngine, ENGINE_STATES } from '../src/quiz/quizEngine.js';
import { purchase } from '../src/economy/shop.js';
import { GameState } from '../src/state/gameState.js';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';

function freshState() {
  return new GameState(new GeonStorage({ backend: memoryBackend() }));
}

/** Build a synthetic question bank for one path. */
function makePathQuestions(count = 80, subject = 'MATH', quizType = 'SUBJECT 1') {
  const out = [];
  for (let lv = 1; lv <= count; lv += 1) {
    out.push({
      id: `t-${subject.replace(' ', '')}-${quizType.replace(' ', '')}-l${lv}`,
      subject,
      quizType,
      level: lv,
      topic: 'Test',
      question: `Q${lv}: what is ${lv} + ${lv}?`,
      choices: [String(lv * 2), String(lv * 2 + 1), String(lv * 2 - 1), String(lv * 3)],
      answer: String(lv * 2),
      explanation: `${lv} + ${lv} = ${lv * 2}`,
      hint: 'Add them.',
    });
  }
  return out;
}

// ---------------------------------------------------------------- gameCore
test('documented constants', () => {
  assert.equal(GAME.START_LIVES, 8);
  assert.equal(GAME.MAX_LIVES, 8);
  assert.equal(GAME.QUESTION_SECONDS, 30);
  assert.equal(GAME.LEVELS_PER_PATH, 80);
  assert.equal(GAME.DAILY_QUESTION_COUNT, 10);
  assert.deepEqual([...GAME.SUBJECTS], ['MATH', 'SCIENCE', 'PSYCHOLOGY', 'TECH 1', 'TECH 2']);
  assert.deepEqual([...GAME.QUIZ_TYPES], ['SUBJECT 1', 'SUBJECT 2']);
});

test('reward bands follow the documented table', () => {
  assert.deepEqual({ ...rewardBandForLevel(1) }, { min: 1, max: 20, score: 50, coins: 5, points: 10 });
  assert.equal(rewardBandForLevel(20).score, 50);
  assert.equal(rewardBandForLevel(21).score, 100);
  assert.equal(rewardBandForLevel(40).coins, 10);
  assert.equal(rewardBandForLevel(41).points, 35);
  assert.equal(rewardBandForLevel(60).score, 175);
  assert.equal(rewardBandForLevel(61).coins, 25);
  assert.equal(rewardBandForLevel(80).points, 60);
  assert.equal(REWARD_BANDS.length, 4);
});

test('streak multipliers follow the documented table', () => {
  assert.equal(multiplierForStreak(1), 1);
  assert.equal(multiplierForStreak(2), 1);
  assert.equal(multiplierForStreak(3), 1.2);
  assert.equal(multiplierForStreak(5), 1.5);
  assert.equal(multiplierForStreak(10), 2);
  assert.equal(multiplierForStreak(15), 2.5);
  assert.equal(multiplierForStreak(20), 3);
  assert.equal(multiplierForStreak(999), 3);
  assert.equal(STREAK_MULTIPLIERS.length, 6);
});

test('streak milestones follow the documented bonuses', () => {
  assert.deepEqual({ ...milestoneForStreak(3) }, { name: 'HOT START', score: 25, coins: 0, points: 0 });
  assert.deepEqual({ ...milestoneForStreak(5) }, { name: 'ON FIRE', score: 50, coins: 5, points: 0 });
  assert.deepEqual({ ...milestoneForStreak(10) }, { name: 'UNSTOPPABLE', score: 100, coins: 10, points: 10 });
  assert.deepEqual({ ...milestoneForStreak(15) }, { name: 'QUIZ MASTER', score: 150, coins: 15, points: 15 });
  assert.deepEqual({ ...milestoneForStreak(20) }, { name: 'LEGENDARY STREAK', score: 250, coins: 25, points: 25 });
  assert.equal(milestoneForStreak(4), null);
});

test('shop prices follow the documented table', () => {
  const prices = Object.fromEntries(SHOP_ITEMS.map((i) => [i.id, i.price]));
  assert.equal(prices.life_token, 100);
  assert.equal(prices.time_boost, 75);
  assert.equal(prices.hint, 100);
  assert.equal(prices.fifty_fifty, 150);
  assert.equal(prices.second_chance, 200);
  assert.equal(SHOP_ITEMS.length, 5);
});

test('scoring combines band x multiplier + milestone', () => {
  // level 5 (band 50), streak 3 -> 50*1.2 = 60 + 25 milestone = 85, coins 5+0, points 10+0
  const r = computeAnswerReward(5, 3);
  assert.equal(r.score, 85);
  assert.equal(r.coins, 5);
  assert.equal(r.points, 10);
  assert.equal(r.milestone.name, 'HOT START');
  // level 61 (band 300), streak 10 -> 300*2 = 600 + 100 = 700, coins 25+10=35, points 60+10=70
  const r2 = computeAnswerReward(61, 10);
  assert.equal(r2.score, 700);
  assert.equal(r2.coins, 35);
  assert.equal(r2.points, 70);
  // no milestone at streak 4
  const r3 = computeAnswerReward(25, 4);
  assert.equal(r3.milestone, null);
  assert.equal(r3.score, Math.round(100 * 1.2));
});

test('sanitizers survive corrupted input', () => {
  const s = sanitizeSettings({ theme: 'hacker', questioner: 'bogus', music: 'yes' });
  assert.equal(s.theme, 'original');
  assert.equal(s.questioner, 'previous');
  assert.equal(s.music, true);
  const p = sanitizeProgress({ previous: { 'BAD|KEY': { highestLevel: 999999 }, [passKey('MATH', 'SUBJECT 1')]: { highestLevel: '12', completedLevels: -5 } }, unknownQuestioner: { x: 1 } });
  assert.equal(p.previous[passKey('MATH', 'SUBJECT 1')].highestLevel, 12);
  assert.equal(p.previous[passKey('MATH', 'SUBJECT 1')].completedLevels, 0);
  assert.equal(p.previous['BAD|KEY'], undefined);
  assert.equal(p.unknownQuestioner, undefined);
  const e = sanitizeEconomy({ coins: 'lots', points: NaN });
  assert.equal(e.coins, 0);
  assert.equal(e.points, 0);
});

// ---------------------------------------------------------------- timer
test('timer counts down, fires timeout once, supports boost', () => {
  let ticks = 0;
  let timeouts = 0;
  const timer = new QuizTimer({
    seconds: 30,
    manual: true,
    onTick: () => { ticks += 1; },
    onTimeout: () => { timeouts += 1; },
  });
  timer.start();
  timer.tick(20);
  assert.equal(Math.ceil(timer.remaining), 10);
  timer.addSeconds(GAME.TIME_BOOST_SECONDS);
  assert.equal(Math.ceil(timer.remaining), 20);
  timer.tick(25);
  assert.equal(timeouts, 1);
  timer.tick(10); // already timed out - must not fire twice
  assert.equal(timeouts, 1);
  assert.ok(ticks > 0);
});

// ---------------------------------------------------------------- session
test('session builder aligns to start level and skips used ids', () => {
  const questions = makePathQuestions(80);
  const session = buildSession({ questions, subject: 'MATH', quizType: 'SUBJECT 1', startLevel: 10, usedIds: [] });
  assert.equal(session.questions.length, 71);
  assert.equal(session.questions[0].level, 10);
  const session2 = buildSession({ questions, subject: 'MATH', quizType: 'SUBJECT 1', startLevel: 1, usedIds: [questions[0].id] });
  assert.equal(session2.questions.length, 79);
  assert.equal(session2.questions[0].level, 2);
});

test('level selection is gated by progression', () => {
  const pass = { highestLevel: 6, completedLevels: 5, bestScore: 0 };
  assert.equal(validateLevelSelection(6, pass).ok, true);
  assert.equal(validateLevelSelection(7, pass).ok, false);
  assert.equal(validateLevelSelection(0, pass).ok, false);
  assert.equal(validateLevelSelection(81, pass).ok, false);
});

// ---------------------------------------------------------------- engine
test('engine: 8 lives, correct -> reward -> next level, victory at 80', () => {
  const questions = makePathQuestions(80);
  const events = { correct: 0, levels: [], victory: false };
  const engine = new QuizEngine({
    mode: 'normal',
    questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 1,
    hooks: {
      onCorrect: () => { events.correct += 1; },
      onLevelComplete: ({ level }) => events.levels.push(level),
      onVictory: () => { events.victory = true; },
    },
    timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true }),
  });
  engine.start();
  assert.equal(engine.lives, 8);
  for (let lv = 1; lv <= 80; lv += 1) {
    const q = engine.current.question;
    engine.answer(q.answer);
    engine.advance();
  }
  assert.equal(events.correct, 80);
  assert.equal(events.levels.length, 80);
  assert.equal(events.victory, true);
  assert.equal(engine.state, ENGINE_STATES.VICTORY);
  assert.ok(engine.score > 0);
  assert.ok(engine.coinsEarned > 0 && engine.pointsEarned > 0);
});

test('engine: wrong answer costs a life; zero lives -> game over with reset flag', () => {
  const questions = makePathQuestions(10);
  let gameOver = null;
  const engine = new QuizEngine({
    mode: 'normal',
    questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 1,
    hooks: { onGameOver: (payload) => { gameOver = payload; } },
    timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true }),
  });
  engine.start();
  const wrong = engine.current.choices.find((c) => c !== engine.current.answer);
  for (let i = 0; i < 8; i += 1) {
    engine.answer(wrong);
  }
  assert.equal(engine.lives, 0);
  assert.equal(engine.state, ENGINE_STATES.GAME_OVER);
  assert.equal(gameOver.resetPass, true);
});

test('engine: second chance prevents life loss and double counting', () => {
  const questions = makePathQuestions(5);
  let secondChances = 0;
  const engine = new QuizEngine({
    mode: 'normal',
    questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 1,
    hooks: {
      onSecondChance: () => { secondChances += 1; },
      canUseSecondChance: () => {
        if (secondChances === 0) {
          return true; // simulate item available once
        }
        return false;
      },
    },
    timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true }),
  });
  engine.start();
  const wrong = engine.current.choices.find((c) => c !== engine.current.answer);
  const firstLevel = engine.currentLevel;
  engine.answer(wrong); // consumes second chance -> same level, no life lost
  assert.equal(secondChances, 1);
  assert.equal(engine.lives, 8);
  assert.equal(engine.currentLevel, firstLevel);
  assert.equal(engine.wrongCount, 1); // counted exactly once
  engine.answer(wrong); // now a real life loss
  assert.equal(engine.lives, 7);
  assert.equal(engine.wrongCount, 2);
});

test('engine: timeout counts as wrong', () => {
  const questions = makePathQuestions(5);
  let wrongs = 0;
  const engine = new QuizEngine({
    mode: 'normal',
    questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 1,
    hooks: { onWrong: () => { wrongs += 1; } },
    timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true, onTimeout: () => engine.handleTimeout() }),
  });
  engine.start();
  engine.timer.tick(31);
  assert.equal(wrongs, 1);
  assert.equal(engine.lives, 7);
});

test('engine: items - life token cap, time boost, hint, 50/50', () => {
  const questions = makePathQuestions(5);
  const engine = new QuizEngine({
    mode: 'normal',
    questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 1,
    timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true }),
  });
  engine.start();
  // life token at full lives -> rejected (cap)
  assert.equal(engine.useItem('life_token').ok, false);
  engine.lives = 5;
  const lifeRes = engine.useItem('life_token');
  assert.equal(lifeRes.ok, true);
  assert.equal(engine.lives, 6);
  // time boost
  const before = engine.timer.remaining;
  const boost = engine.useItem('time_boost');
  assert.equal(boost.ok, true);
  assert.equal(Math.ceil(engine.timer.remaining), Math.ceil(before) + 10);
  // hint
  const hintRes = engine.useItem('hint');
  assert.equal(hintRes.ok, true);
  assert.ok(hintRes.hint.length > 0);
  // 50/50 removes exactly two wrong choices, keeps the answer
  const ff = engine.useItem('fifty_fifty');
  assert.equal(ff.ok, true);
  assert.equal(ff.removed.length, 2);
  assert.ok(!ff.removed.includes(engine.current.answer));
  assert.equal(engine.current.eliminated.length, 2);
});

// ---------------------------------------------------------------- shop
test('shop purchase validates coins and grants items', () => {
  const state = freshState();
  assert.equal(purchase(state, 'life_token', 1).ok, false); // broke
  state.addCoins(175);
  assert.equal(purchase(state, 'second_chance', 1).ok, false); // 200 > 175
  const res = purchase(state, 'time_boost', 2); // 150
  assert.equal(res.ok, true);
  assert.equal(state.economy.coins, 25);
  assert.equal(state.itemCount('time_boost'), 2);
  assert.equal(purchase(state, 'bogus_item', 1).ok, false);
});
