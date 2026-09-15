/**
 * GEON'S GAMEHUB - rewards.js
 * Rewards boundary: applies documented rewards to GameState EXACTLY once per
 * event. Every guarded reward (daily/story/mission) uses claim flags so coins
 * and points can never be duplicated.
 */
import { STORY_REWARDS, MISSION_REWARDS, DAILY_REWARD } from '../gameCore.js';
import { claimDailyReward } from '../data/dailyChallenge.js';

/** Apply one correct-answer reward (already computed by scoring.js). */
export function applyAnswerReward(state, reward) {
  const coins = state.addCoins(reward.coins);
  const points = state.addPoints(reward.points);
  return { coins, points };
}

/** Daily completion reward: +100 points, +5 coins, guarded by rewardClaimed. */
export function claimDailyCompletion(state, dailyKey) {
  if (!claimDailyReward(state.daily, dailyKey)) return null;
  state.addPoints(DAILY_REWARD.points);
  state.addCoins(DAILY_REWARD.coins);
  return { points: DAILY_REWARD.points, coins: DAILY_REWARD.coins };
}

/** Story base completion reward: +75 points, +15 coins (once per story). */
export function claimStoryBase(state, storyId) {
  const entry = state.story.completed[storyId] || { baseClaimed: false, perfectClaimed: false, correct: 0, total: 0 };
  if (entry.baseClaimed) return null;
  entry.baseClaimed = true;
  state.story.completed[storyId] = entry;
  state.addPoints(STORY_REWARDS.complete.points);
  state.addCoins(STORY_REWARDS.complete.coins);
  return { points: STORY_REWARDS.complete.points, coins: STORY_REWARDS.complete.coins };
}

/** Story perfect bonus: +50 points, +10 coins (once per story). */
export function claimStoryPerfect(state, storyId) {
  const entry = state.story.completed[storyId];
  if (!entry || !entry.baseClaimed || entry.perfectClaimed) return null;
  entry.perfectClaimed = true;
  state.addPoints(STORY_REWARDS.perfect.points);
  state.addCoins(STORY_REWARDS.perfect.coins);
  return { points: STORY_REWARDS.perfect.points, coins: STORY_REWARDS.perfect.coins };
}

/** All-stories bonus: +200 points, +50 coins (once ever). */
export function claimAllStoriesBonus(state, totalStories) {
  if (state.story.allClaimed) return null;
  if (Object.keys(state.story.completed).filter((id) => state.story.completed[id].baseClaimed).length < totalStories) {
    return null;
  }
  state.story.allClaimed = true;
  state.addPoints(STORY_REWARDS.allComplete.points);
  state.addCoins(STORY_REWARDS.allComplete.coins);
  return { points: STORY_REWARDS.allComplete.points, coins: STORY_REWARDS.allComplete.coins };
}

/** Per-mission reward: +100 points, +20 coins (guarded per run via claim flags). */
export function claimMissionReward(state, run, missionIndex) {
  if (run.claimed[missionIndex]) return null;
  run.claimed[missionIndex] = true;
  state.addPoints(MISSION_REWARDS.perMission.points);
  state.addCoins(MISSION_REWARDS.perMission.coins);
  state.missions.missionsCompleted += 1;
  return { points: MISSION_REWARDS.perMission.points, coins: MISSION_REWARDS.perMission.coins };
}

/** All-5-missions bonus: +250 points, +75 coins (guarded per run). */
export function claimAllMissionsBonus(state, run) {
  if (run.allClaimed) return null;
  run.allClaimed = true;
  state.addPoints(MISSION_REWARDS.allComplete.points);
  state.addCoins(MISSION_REWARDS.allComplete.coins);
  state.missions.runsCompleted += 1;
  return { points: MISSION_REWARDS.allComplete.points, coins: MISSION_REWARDS.allComplete.coins };
}
