/**
 * GEON'S GAMEHUB - tests/node_smoke.mjs
 * Headless smoke run of every src/ module flow (no DOM required).
 * Invoked by tests/browser_smoke.py and runnable directly: node tests/node_smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { GAME } = await import('../src/gameCore.js');
const { GeonStorage, memoryBackend } = await import('../src/state/storage.js');
const { SettingsState } = await import('../src/state/settingsState.js');
const { GameState } = await import('../src/state/gameState.js');
const { validateBank } = await import('../src/data/questionValidator.js');
const { verifyDistribution } = await import('../src/data/subjectCatalog.js');
const { buildSession } = await import('../src/quiz/sessionBuilder.js');
const { QuizEngine } = await import('../src/quiz/quizEngine.js');
const { QuizTimer } = await import('../src/quiz/timer.js');
const rewards = await import('../src/economy/rewards.js');
const shop = await import('../src/economy/shop.js');
const { buildDaily } = await import('../src/data/dailyChallenge.js');
const { MissionRun } = await import('../src/mission/mission.js');
const { STORIES } = await import('../src/story/storyData.js');
const { StoryRun } = await import('../src/story/storyQuiz.js');
const { evaluate } = await import('../src/progression/achievements.js');
const { titleFor } = await import('../src/progression/titles.js');
const { AudioManager } = await import('../src/audio/audioManager.js');
const { AIReader } = await import('../src/accessibility/reader.js');

const prevBank = JSON.parse(readFileSync(path.join(root, 'questions.json'), 'utf8'));
const newBank = JSON.parse(readFileSync(path.join(root, 'questions.new.json'), 'utf8'));

// 1. banks
for (const doc of [prevBank, newBank]) {
  const v = validateBank(doc);
  assert.equal(v.errors.length, 0, `bank ${doc.questioner} invalid: ${v.errors.slice(0, 2)}`);
  assert.equal(verifyDistribution(doc.questions).length, 0, `bank ${doc.questioner} distribution off`);
}

// 2. state bootstrap on memory storage
const storage = new GeonStorage({ backend: memoryBackend() });
const settings = new SettingsState(storage);
const state = new GameState(storage);
assert.equal(state.economy.coins, 0);

// 3. normal quiz: 15 levels on TECH 2 SUBJECT 1
const session = buildSession({
  questions: prevBank.questions,
  subject: 'TECH 2',
  quizType: 'SUBJECT 1',
  startLevel: 1,
  usedIds: [],
});
assert.equal(session.questions.length, 80);
let victories = 0;
const engine = new QuizEngine({
  mode: 'normal',
  questions: session.questions.slice(0, 15),
  subject: 'TECH 2',
  quizType: 'SUBJECT 1',
  startLevel: 1,
  timerFactory: ({ seconds }) => new QuizTimer({ seconds, manual: true }),
  hooks: {
    onCorrect: ({ reward, level }) => {
      rewards.applyAnswerReward(state, reward);
      state.recordAnswer('previous', 'TECH 2', true);
      state.recordLevelComplete('previous', 'TECH 2', 'SUBJECT 1', level, engine.score);
    },
    onVictory: () => { victories += 1; },
  },
});
engine.start();
for (let i = 0; i < 14; i += 1) {
  engine.answer(engine.current.question.answer);
  engine.advance();
}
assert.equal(state.getPass('previous', 'TECH 2', 'SUBJECT 1').completedLevels, 14);
assert.ok(state.economy.coins >= 70, 'coins accrued');

// 4. shop + items mid-quiz (question 15 is still active)
state.addCoins(500);
assert.equal(shop.purchase(state, 'fifty_fifty', 1).ok, true);
assert.equal(shop.purchase(state, 'time_boost', 1).ok, true);
const ff = engine.useItem('fifty_fifty');
assert.equal(ff.ok, true);
assert.equal(ff.removed.length, 2);
assert.ok(!ff.removed.includes(engine.current.answer));
const boost = engine.useItem('time_boost');
assert.equal(boost.ok, true);
// finish the 15th level
engine.answer(engine.current.question.answer);
engine.advance();
assert.equal(state.getPass('previous', 'TECH 2', 'SUBJECT 1').completedLevels, 15);

// 5. daily determinism
const d1 = buildDaily(prevBank.questions, 'previous', '2026-03-01');
const d2 = buildDaily(prevBank.questions, 'previous', '2026-03-01');
assert.deepEqual(d1.questions.map((q) => q.id), d2.questions.map((q) => q.id));
const dailyReward = rewards.claimDailyCompletion(state, '2026-03-01::previous');
assert.deepEqual(dailyReward, { points: 100, coins: 5 });
assert.equal(rewards.claimDailyCompletion(state, '2026-03-01::previous'), null);

// 6. story full run
const story = STORIES[0];
const storyRun = new StoryRun({
  storyId: story.id,
  onReward: (kind, id) => {
    if (kind === 'base') return rewards.claimStoryBase(state, id);
    if (kind === 'perfect') return rewards.claimStoryPerfect(state, id);
    return rewards.claimAllStoriesBonus(state, STORIES.length);
  },
});
for (const q of story.questions) storyRun.answer(q.answer);
const storyResults = storyRun.results();
assert.equal(storyResults.perfect, true);
assert.ok(storyResults.rewards.baseReward);

// 7. mission full run
const missionRun = new MissionRun({
  onReward: (kind, index, run) =>
    kind === 'mission' ? rewards.claimMissionReward(state, run, index) : rewards.claimAllMissionsBonus(state, run),
});
missionRun.start();
for (let i = 0; i < 5; i += 1) missionRun.answer(missionRun.current.answer);
assert.equal(missionRun.summary.allCompleted, true);
assert.equal(state.missions.missionsCompleted, 5);

// 8. conversion + progression + titles
state.addPoints(60);
const conv = state.convertPointsToCoins(2);
assert.equal(conv.ok, true);
assert.equal(conv.coins, 10);
const achv = evaluate(state, 'previous', { bestStreak: 15, perfectRun: true, levelsCompleted: 15, survivedRun: true, speedHit: true, subject: 'TECH 2' });
assert.ok(achv.length >= 3, 'achievements should unlock');
assert.ok(titleFor(state.totalCompletedLevels('previous')).title);

// 9. save round trip
state.save();
const exported = storage.exportAll();
const target = new GeonStorage({ backend: memoryBackend() });
assert.equal(target.importAll(exported).ok, true);
const restored = new GameState(target);
assert.equal(restored.getPass('previous', 'TECH 2', 'SUBJECT 1').completedLevels, 15);
assert.equal(restored.economy.coins, state.economy.coins);

// 10. audio + reader safety in a DOM-free environment
const audio = new AudioManager({ settings });
audio.playMusic('home'); // no Audio impl -> silent no-op, must not throw
audio.playSfx('click');
audio.stopMusic();
const reader = new AIReader({ settings });
settings.update({ reader: true });
assert.equal(reader.speak('test'), false); // no synth available

console.log('node smoke: all module flows OK (banks, quiz, daily, story, mission, shop, conversion, achievements, save, audio, reader)');
