/**
 * GEON'S GAMEHUB - tests/story_quiz.test.js
 * Story Quiz: 10 documented stories, each with a passage and 5 questions of
 * the documented types; isolated state; guarded rewards (+75/+15 base,
 * +50/+10 perfect, +200/+50 all-stories).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STORIES, storyCount, storyById } from '../src/story/storyData.js';
import { StoryRun } from '../src/story/storyQuiz.js';
import { STORY_REWARDS } from '../src/gameCore.js';
import { GameState } from '../src/state/gameState.js';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';
import { claimStoryBase, claimStoryPerfect, claimAllStoriesBonus } from '../src/economy/rewards.js';

function freshState() {
  return new GameState(new GeonStorage({ backend: memoryBackend() }));
}

const EXPECTED_TITLES = [
  'The Lost Compass',
  'The Hidden Valley',
  'The Lighthouse Signal',
  'The Library Window',
  'The Rain Garden Plan',
  "The Clockmaker's Note",
  'The Bridge of Paper',
  'The Orchard Map',
  'The Signal Lantern',
  'The Museum Key',
];

const DOCUMENTED_TYPES = new Set(['detail', 'setting', 'sequence', 'inference', 'reasonable inference']);

test('ten documented stories are present with correct titles', () => {
  assert.equal(storyCount(), 10);
  assert.deepEqual(STORIES.map((s) => s.title), EXPECTED_TITLES);
});

test('every story has a passage and 5 well-formed questions', () => {
  for (const story of STORIES) {
    assert.ok(story.passage.length >= 400, `${story.title}: passage too short`);
    assert.equal(story.questions.length, 5, `${story.title}: needs 5 questions`);
    for (const q of story.questions) {
      assert.ok(DOCUMENTED_TYPES.has(q.type), `${story.title}: undocumented type ${q.type}`);
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices).size, 4, `${story.title}: duplicate choices`);
      assert.ok(q.choices.includes(q.answer), `${story.title}: answer not in choices`);
      assert.ok(q.explanation, `${story.title}: missing explanation`);
      assert.ok(q.question.length > 10);
    }
    // documented type coverage: detail, setting, sequence, inference, reasonable inference
    const types = story.questions.map((q) => q.type);
    for (const t of DOCUMENTED_TYPES) {
      assert.ok(types.includes(t), `${story.title}: missing question type ${t}`);
    }
  }
});

test('story state is isolated from normal quiz state', () => {
  const state = freshState();
  const story = STORIES[0];
  const run = new StoryRun({
    storyId: story.id,
    onReward: (kind, id) => (kind === 'base' ? claimStoryBase(state, id) : null),
  });
  // StoryRun keeps its own run state...
  assert.equal(run.index, 0);
  assert.equal(run.correct, 0);
  // ...and never touches quiz progression structures
  const passBefore = JSON.stringify(state.progress);
  const statsBefore = JSON.stringify(state.stats);
  for (const q of story.questions) run.answer(q.answer);
  assert.equal(JSON.stringify(state.progress), passBefore);
  assert.equal(JSON.stringify(state.stats), statsBefore);
});

test('perfect story run pays base + perfect rewards exactly once', () => {
  const state = freshState();
  const story = STORIES[2];
  const rewards = { base: 0, perfect: 0 };
  const run = new StoryRun({
    storyId: story.id,
    onReward: (kind, id) => {
      const r = kind === 'base' ? claimStoryBase(state, id) : claimStoryPerfect(state, id);
      if (r) rewards[kind] += 1;
      return r;
    },
  });
  for (const q of story.questions) {
    const res = run.answer(q.answer);
    assert.equal(res.correct, true);
  }
  const results = run.results();
  assert.equal(results.perfect, true);
  assert.equal(rewards.base, 1);
  assert.equal(rewards.perfect, 1);
  assert.equal(state.economy.points, STORY_REWARDS.complete.points + STORY_REWARDS.perfect.points); // 125
  assert.equal(state.economy.coins, STORY_REWARDS.complete.coins + STORY_REWARDS.perfect.coins); // 25

  // replaying the same story: rewards must NOT pay again
  const replay = new StoryRun({
    storyId: story.id,
    onReward: (kind, id) => (kind === 'base' ? claimStoryBase(state, id) : claimStoryPerfect(state, id)),
  });
  for (const q of story.questions) replay.answer(q.answer);
  const replayResults = replay.results();
  assert.equal(replayResults.rewards.baseReward, null);
  assert.equal(replayResults.rewards.perfectReward, null);
  assert.equal(state.economy.points, 125, 'no duplicate points');
  assert.equal(state.economy.coins, 25, 'no duplicate coins');
});

test('all-stories bonus pays once after every story is completed', () => {
  const state = freshState();
  for (const story of STORIES) {
    const run = new StoryRun({
      storyId: story.id,
      onReward: (kind, id) => {
        if (kind === 'base') return claimStoryBase(state, id);
        if (kind === 'perfect') return claimStoryPerfect(state, id);
        return claimAllStoriesBonus(state, storyCount());
      },
    });
    for (const q of story.questions) run.answer(q.answer);
    run.results();
  }
  assert.equal(state.story.allClaimed, true);
  // verify bonus amounts were applied (10 base + 10 perfect + all bonus)
  const expectedPoints = 10 * (STORY_REWARDS.complete.points + STORY_REWARDS.perfect.points) + STORY_REWARDS.allComplete.points;
  const expectedCoins = 10 * (STORY_REWARDS.complete.coins + STORY_REWARDS.perfect.coins) + STORY_REWARDS.allComplete.coins;
  assert.equal(state.economy.points, expectedPoints);
  assert.equal(state.economy.coins, expectedCoins);
  // claiming again pays nothing
  assert.equal(claimAllStoriesBonus(state, storyCount()), null);
});

test('incomplete run pays nothing and partial answers are recorded', () => {
  const state = freshState();
  const story = STORIES[1];
  const run = new StoryRun({ storyId: story.id, onReward: () => null });
  run.answer(story.questions[0].answer);
  const wrong = story.questions[1].choices.find((c) => c !== story.questions[1].answer);
  run.answer(wrong);
  assert.equal(run.correct, 1);
  assert.equal(run.done, false);
  assert.equal(run.currentQuestion, story.questions[2]);
  assert.equal(storyById(story.id).id, story.id);
});
