/**
 * GEON'S GAMEHUB - tests/regression.test.js
 * End-to-end regression checks across module boundaries:
 * normal quiz progression + persistence, game-over reset, daily determinism
 * and reward guard, points->coins conversion, save export/import round-trip,
 * corrupted-save resilience, audio manager exclusivity, reader no-op safety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { GAME } from '../src/gameCore.js';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';
import { SettingsState } from '../src/state/settingsState.js';
import { GameState } from '../src/state/gameState.js';
import { QuizEngine } from '../src/quiz/quizEngine.js';
import { QuizTimer } from '../src/quiz/timer.js';
import { buildSession } from '../src/quiz/sessionBuilder.js';
import { applyAnswerReward, claimDailyCompletion } from '../src/economy/rewards.js';
import { buildDaily, selectDailyQuestions, dailySeed, dailyStateKey, todayKey } from '../src/data/dailyChallenge.js';
import { evaluate as evaluateAchievements } from '../src/progression/achievements.js';
import { titleFor } from '../src/progression/titles.js';
import { AudioManager } from '../src/audio/audioManager.js';
import { AIReader } from '../src/accessibility/reader.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bank = JSON.parse(readFileSync(path.join(root, 'questions.json'), 'utf8')).questions;

function freshState() {
  return new GameState(new GeonStorage({ backend: memoryBackend() }));
}

function manualTimer({ seconds }) {
  return new QuizTimer({ seconds, manual: true });
}

/** Simulate a normal quiz run of `levels` correct answers from startLevel. */
function playCorrect(state, { subject, quizType, startLevel, levels, questioner = 'previous' }) {
  const session = buildSession({ questions: bank, subject, quizType, startLevel, usedIds: [] });
  let victory = false;
  const engine = new QuizEngine({
    mode: 'normal',
    questions: session.questions,
    subject,
    quizType,
    startLevel,
    timerFactory: manualTimer,
    hooks: {
      onCorrect: ({ reward, level }) => {
        applyAnswerReward(state, reward);
        state.recordAnswer(questioner, subject, true);
        state.recordLevelComplete(questioner, subject, quizType, level, engine.score);
      },
      onVictory: () => { victory = true; },
    },
  });
  engine.start();
  for (let i = 0; i < levels; i += 1) {
    if (engine.state === 'VICTORY') break;
    engine.answer(engine.current.question.answer);
    engine.advance();
  }
  return { engine, victory };
}

test('normal quiz: 10 correct levels persist progression and economy', () => {
  const state = freshState();
  const { engine } = playCorrect(state, { subject: 'MATH', quizType: 'SUBJECT 1', startLevel: 1, levels: 10 });
  const pass = state.getPass('previous', 'MATH', 'SUBJECT 1');
  assert.equal(pass.completedLevels, 10);
  assert.equal(pass.highestLevel, 11);
  assert.equal(pass.bestScore, engine.score);
  // levels 1-10 => band 1: 10 x (5 coins, 10 points) = 50 coins, 100 points
  // plus documented streak milestones: ON FIRE at 5 (+5 coins),
  // UNSTOPPABLE at 10 (+10 coins, +10 points)
  assert.equal(state.economy.coins, 50 + 5 + 10);
  assert.equal(state.economy.points, 100 + 10);
  assert.ok(engine.score >= 500); // 10 x 50 base minimum
  // persistence round trip
  state.save();
  const reloaded = new GameState(state.storage);
  assert.equal(reloaded.getPass('previous', 'MATH', 'SUBJECT 1').completedLevels, 10);
  assert.equal(reloaded.economy.coins, 65);
});

test('normal quiz: reaching level 80 triggers victory exactly once', () => {
  const state = freshState();
  // progression must be sequential: play the whole 1..80 path
  const { engine, victory } = playCorrect(state, { subject: 'SCIENCE', quizType: 'SUBJECT 2', startLevel: 1, levels: 80 });
  assert.equal(victory, true);
  assert.equal(engine.state, 'VICTORY');
  assert.equal(state.getPass('previous', 'SCIENCE', 'SUBJECT 2').completedLevels, 80);
});

test('out-of-order level completions are rejected (progression safety)', () => {
  const state = freshState();
  // jumping straight to level 71 on a fresh pass must not fabricate progress
  playCorrect(state, { subject: 'MATH', quizType: 'SUBJECT 2', startLevel: 71, levels: 5 });
  assert.equal(state.getPass('previous', 'MATH', 'SUBJECT 2').completedLevels, 0);
});

test('game over: zero lives resets only the active pass', () => {
  const state = freshState();
  playCorrect(state, { subject: 'MATH', quizType: 'SUBJECT 1', startLevel: 1, levels: 4 });
  playCorrect(state, { subject: 'MATH', quizType: 'SUBJECT 2', startLevel: 1, levels: 3 });

  const session = buildSession({ questions: bank, subject: 'MATH', quizType: 'SUBJECT 1', startLevel: 5, usedIds: [] });
  let gameOver = null;
  const engine = new QuizEngine({
    mode: 'normal',
    questions: session.questions,
    subject: 'MATH',
    quizType: 'SUBJECT 1',
    startLevel: 5,
    timerFactory: manualTimer,
    hooks: { onGameOver: (p) => { gameOver = p; } },
  });
  engine.start();
  const wrong = engine.current.choices.find((c) => c !== engine.current.answer);
  for (let i = 0; i < 8; i += 1) engine.answer(wrong);
  assert.equal(gameOver.resetPass, true);
  state.resetPass('previous', 'MATH', 'SUBJECT 1');
  assert.equal(state.getPass('previous', 'MATH', 'SUBJECT 1').completedLevels, 0);
  assert.equal(state.getPass('previous', 'MATH', 'SUBJECT 1').highestLevel, 1);
  // other pass untouched
  assert.equal(state.getPass('previous', 'MATH', 'SUBJECT 2').completedLevels, 3);
});

test('daily challenge: deterministic per date+questioner, differs across both', () => {
  const dateStr = '2026-01-15';
  const prevDaily = buildDaily(bank, 'previous', dateStr);
  const againDaily = buildDaily(bank, 'previous', dateStr);
  assert.deepEqual(prevDaily.questions.map((q) => q.id), againDaily.questions.map((q) => q.id), 'same date+questioner must be stable');
  assert.equal(prevDaily.questions.length, 10);
  const newDaily = buildDaily(bank, 'new', dateStr);
  const otherDay = buildDaily(bank, 'previous', '2026-01-16');
  assert.notDeepEqual(prevDaily.questions.map((q) => q.id), newDaily.questions.map((q) => q.id), 'questioners differ');
  assert.notDeepEqual(prevDaily.questions.map((q) => q.id), otherDay.questions.map((q) => q.id), 'dates differ');
  // ranking is stable for identical seeds
  const ids1 = selectDailyQuestions(bank, dailySeed(dateStr, 'previous')).map((q) => q.id);
  const ids2 = selectDailyQuestions(bank, dailySeed(dateStr, 'previous')).map((q) => q.id);
  assert.deepEqual(ids1, ids2);
  assert.ok(dailyStateKey(todayKey(), 'previous').includes('::previous'));
});

test('daily reward: pays once, guard survives persistence', () => {
  const state = freshState();
  const key = dailyStateKey('2026-02-02', 'previous');
  const first = claimDailyCompletion(state, key);
  assert.deepEqual(first, { points: 100, coins: 5 });
  assert.equal(claimDailyCompletion(state, key), null, 'second claim blocked');
  state.save();
  const reloaded = new GameState(state.storage);
  assert.equal(claimDailyCompletion(reloaded, key), null, 'guard survives reload');
  // a different day still pays
  const nextDay = claimDailyCompletion(reloaded, dailyStateKey('2026-02-03', 'previous'));
  assert.deepEqual(nextDay, { points: 100, coins: 5 });
});

test('points -> coins conversion respects the rate and balance', () => {
  const state = freshState();
  state.addPoints(100);
  const res = state.convertPointsToCoins(3); // 30 points -> 15 coins
  assert.equal(res.ok, true);
  assert.equal(state.economy.points, 70);
  assert.equal(state.economy.coins, 15);
  const tooMuch = state.convertPointsToCoins(100); // 1000 points needed
  assert.equal(tooMuch.ok, false);
  assert.equal(state.economy.points, 70, 'failed conversion must not spend');
  assert.equal(state.convertPointsToCoins(0).ok, false);
});

test('save export -> import round-trip preserves progress and economy', () => {
  const state = freshState();
  playCorrect(state, { subject: 'PSYCHOLOGY', quizType: 'SUBJECT 1', startLevel: 1, levels: 5 });
  state.addCoins(40);
  state.addItem('hint', 2);
  state.save();
  const exportData = state.storage.exportAll();

  const target = new GameState(new GeonStorage({ backend: memoryBackend() }));
  const result = target.storage.importAll(exportData);
  assert.equal(result.ok, true);
  const restored = new GameState(target.storage);
  assert.equal(restored.getPass('previous', 'PSYCHOLOGY', 'SUBJECT 1').completedLevels, 5);
  assert.equal(restored.economy.coins, state.economy.coins);
  assert.equal(restored.itemCount('hint'), 2);
});

test('corrupted storage never crashes state construction', () => {
  const storage = new GeonStorage({ backend: memoryBackend() });
  storage.backend.setItem(`${GAME.STORAGE_PREFIX}:progress`, '{{{{corrupt');
  storage.backend.setItem(`${GAME.STORAGE_PREFIX}:economy`, '{"coins":"infinity","points":[]}');
  storage.backend.setItem(`${GAME.STORAGE_PREFIX}:inventory`, '{"life_token":"many"}');
  storage.backend.setItem(`${GAME.STORAGE_PREFIX}:achievements`, 'null');
  const state = new GameState(storage); // must not throw
  assert.equal(state.economy.coins, 0);
  assert.equal(state.economy.points, 0);
  assert.equal(state.itemCount('life_token'), 0);
  assert.deepEqual(state.achievements, {});
  state.save();
  const reloaded = new GameState(storage);
  assert.equal(reloaded.economy.coins, 0);
});

test('import of a tampered payload cannot inject invalid progress keys', () => {
  const state = freshState();
  const tampered = {
    schemaVersion: GAME.SCHEMA_VERSION,
    keys: {
      progress: {
        previous: { 'HACK|SUBJECT 9': { highestLevel: 80, completedLevels: 80 } },
        alien: { anything: 1 },
      },
      economy: { coins: 99999999999999, points: -50 },
    },
  };
  const res = state.storage.importAll(tampered);
  assert.equal(res.ok, true);
  const reloaded = new GameState(state.storage);
  assert.equal(reloaded.progress.previous['HACK|SUBJECT 9'], undefined, 'unknown pass key dropped');
  assert.equal(reloaded.progress.alien, undefined, 'unknown questioner dropped');
  assert.ok(reloaded.economy.coins <= 1000000, 'absurd values clamped');
  assert.equal(reloaded.economy.points, 0, 'negative points sanitized');
});

test('achievements unlock once and track subject completion', () => {
  const state = freshState();
  // speed + streak style summary
  const summary1 = { bestStreak: 12, perfectRun: true, levelsCompleted: 6, survivedRun: true, speedHit: true, subject: 'TECH 1' };
  const first = evaluateAchievements(state, 'previous', summary1);
  const ids = first.map((a) => a.id).sort();
  assert.deepEqual(ids, ['perfect_level', 'speed_quizzer', 'streak_master', 'survivor']);
  const second = evaluateAchievements(state, 'previous', summary1);
  assert.deepEqual(second, [], 'no double unlocks');
  // subject completion needs 160 levels
  for (const quiz of GAME.QUIZ_TYPES) {
    const pass = state.getPass('previous', 'TECH 1', quiz);
    pass.completedLevels = 80;
  }
  const third = evaluateAchievements(state, 'previous', { subject: 'TECH 1', bestStreak: 0, perfectRun: false, levelsCompleted: 0, survivedRun: false, speedHit: false });
  assert.ok(third.some((a) => a.id === 'tech1_completed'));
});

test('titles ladder follows total completed levels', () => {
  assert.equal(titleFor(0).title, 'NOVICE');
  assert.equal(titleFor(25).title, 'SCHOLAR');
  assert.equal(titleFor(800).title, "GEON'S CHAMPION");
});

test('audio manager plays only one music track at a time', () => {
  const played = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.loop = false;
      this.volume = 1;
      this._listeners = {};
    }
    addEventListener(name, fn) {
      this._listeners[name] = fn;
    }
    play() {
      this.paused = false;
      played.push(this.src);
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const settings = new SettingsState(new GeonStorage({ backend: memoryBackend() }));
  const audio = new AudioManager({ settings, AudioImpl: FakeAudio });
  audio.playMusic('home');
  audio.playMusic('game');
  assert.deepEqual(played, ['home-music.mp3', 'game-music.mp3']);
  // replaying the same track does not restart it
  audio.playMusic('game');
  assert.equal(played.length, 2);
  audio.stopMusic();
  assert.equal(audio.currentMusicName, null);
  // music disabled -> nothing plays
  settings.update({ music: false });
  audio.playMusic('victory');
  assert.equal(played.length, 2);
});

test('AI reader is a safe no-op without speech synthesis', () => {
  const settings = new SettingsState(new GeonStorage({ backend: memoryBackend() }));
  settings.update({ reader: true });
  const reader = new AIReader({ settings, synth: null, getActiveScreen: () => null });
  assert.equal(reader.speak('hello'), false);
  assert.equal(reader.readCurrentScreen(), false);
  reader.stop(); // must not throw
  reader.refresh(); // must not throw
  // with an injectable synth double it records utterances
  const synth = { __utterances: [], cancel: () => {} };
  const reader2 = new AIReader({ settings, synth, getActiveScreen: () => ({ innerText: 'Quiz screen' }) });
  assert.equal(reader2.readCurrentScreen(), true);
  assert.equal(synth.__utterances.length, 1);
});
