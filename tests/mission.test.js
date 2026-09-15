/**
 * GEON'S GAMEHUB - tests/mission.test.js
 * Mission engine: 5 missions, one per subject family; +100 pts/+20 coins per
 * completed mission; +250 pts/+75 coins for all five; guarded against
 * duplicate claims; wrong answers allow retries without rewards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MISSIONS } from '../src/mission/missionData.js';
import { MissionRun } from '../src/mission/mission.js';
import { MISSION_REWARDS, GAME } from '../src/gameCore.js';
import { GameState } from '../src/state/gameState.js';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';
import { claimMissionReward, claimAllMissionsBonus } from '../src/economy/rewards.js';

function freshState() {
  return new GameState(new GeonStorage({ backend: memoryBackend() }));
}

test('five missions exist, one per subject family', () => {
  assert.equal(MISSIONS.length, 5);
  assert.equal(MISSION_COUNT_CHECK(), true);
  const subjects = MISSIONS.map((m) => m.subject).sort();
  assert.deepEqual(subjects, [...GAME.SUBJECTS].sort());
  for (const m of MISSIONS) {
    assert.ok(m.name && m.brief && m.question, `mission ${m.id} content`);
    assert.equal(m.choices.length, 4);
    assert.ok(m.choices.includes(m.answer), `mission ${m.id} answer in choices`);
    assert.equal(new Set(m.choices).size, 4, `mission ${m.id} unique choices`);
    assert.ok(m.explanation);
  }
  function MISSION_COUNT_CHECK() {
    return MISSIONS.length === GAME.MISSION_COUNT;
  }
});

test('full mission run grants exactly the documented rewards once', () => {
  const state = freshState();
  const run = new MissionRun({
    onReward: (kind, index, r) => {
      if (kind === 'mission') return claimMissionReward(state, r, index);
      if (kind === 'all') return claimAllMissionsBonus(state, r);
      return null;
    },
  });
  run.start();
  for (let i = 0; i < 5; i += 1) {
    const mission = run.current;
    const result = run.answer(mission.answer);
    assert.equal(result.correct, true);
    assert.deepEqual(result.reward, { points: 100, coins: 20 });
  }
  assert.equal(run.done, true);
  assert.equal(state.economy.points, 5 * MISSION_REWARDS.perMission.points + MISSION_REWARDS.allComplete.points); // 750
  assert.equal(state.economy.coins, 5 * MISSION_REWARDS.perMission.coins + MISSION_REWARDS.allComplete.coins); // 175
  assert.equal(state.missions.missionsCompleted, 5);
  assert.equal(state.missions.runsCompleted, 1);
});

test('claim guards block duplicate mission rewards', () => {
  const state = freshState();
  const run = { claimed: {}, allClaimed: false };
  const first = claimMissionReward(state, run, 0);
  assert.deepEqual(first, { points: 100, coins: 20 });
  const second = claimMissionReward(state, run, 0);
  assert.equal(second, null);
  run.claimed = { 0: true, 1: true, 2: true, 3: true, 4: true };
  const allFirst = claimAllMissionsBonus(state, run);
  assert.deepEqual(allFirst, { points: 250, coins: 75 });
  const allSecond = claimAllMissionsBonus(state, run);
  assert.equal(allSecond, null);
  assert.equal(state.economy.points, 100 + 250);
});

test('wrong answer does not reward or advance; retry can complete', () => {
  const state = freshState();
  let rewards = 0;
  const run = new MissionRun({
    onReward: (kind, index, r) => {
      rewards += 1;
      return claimMissionReward(state, r, index);
    },
  });
  run.start();
  const mission = run.current;
  const wrong = mission.choices.find((c) => c !== mission.answer);
  const res = run.answer(wrong);
  assert.equal(res.correct, false);
  assert.equal(res.reward, null);
  assert.equal(run.index, 0, 'mission must not advance on a wrong answer');
  assert.equal(rewards, 0);
  const retry = run.answer(mission.answer);
  assert.equal(retry.correct, true);
  assert.equal(run.index, 1);
  assert.equal(rewards, 1);
});
