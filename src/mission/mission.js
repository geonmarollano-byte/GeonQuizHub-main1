/**
 * GEON'S GAMEHUB - mission.js
 * Mission engine: HOME -> START YOUR MISSION -> Mission 1..5 -> Results.
 * Rewards: +100 points and +20 coins per completed mission; +250 points and
 * +75 coins when all five are completed. Claim flags inside the run object
 * guarantee each reward is granted exactly once.
 * The engine is storage-free; script.js applies rewards through rewards.js.
 */
import { MISSIONS } from './missionData.js';

export class MissionRun {
  /**
   * @param {object} opts
   *   hooks: { onMission, onResult, onComplete }
   *   onReward: (kind:'mission'|'all', missionIndex) => applied reward (caller grants, guarded)
   */
  constructor({ hooks = {}, onReward } = {}) {
    this.missions = MISSIONS;
    this.hooks = hooks;
    this.onReward = onReward || (() => null);
    this.index = 0;
    this.correct = 0;
    this.claimed = {};
    this.allClaimed = false;
    this.done = false;
  }

  get current() {
    return this.missions[this.index] || null;
  }

  start() {
    if (this.hooks.onMission) this.hooks.onMission({ mission: this.current, index: this.index, total: this.missions.length });
    return this;
  }

  /** Answer the current mission's question. Wrong answers allow a retry;
   *  the mission reward is claimed only once, on completion. */
  answer(choice) {
    const mission = this.current;
    if (!mission || this.done) return { accepted: false };
    const correct = choice === mission.answer;
    const result = {
      accepted: true,
      correct,
      explanation: mission.explanation,
      answer: mission.answer,
      reward: null,
      allReward: null,
    };
    if (correct) {
      this.correct += 1;
      result.reward = this.onReward('mission', this.index, this);
      this.index += 1;
      if (this.index >= this.missions.length) {
        this.done = true;
        result.allReward = this.onReward('all', -1, this);
        if (this.hooks.onComplete) this.hooks.onComplete(this.summary);
      } else if (this.hooks.onMission) {
        this.hooks.onMission({ mission: this.current, index: this.index, total: this.missions.length });
      }
    }
    if (this.hooks.onResult) this.hooks.onResult(result);
    return result;
  }

  get summary() {
    return {
      total: this.missions.length,
      completed: this.index,
      correct: this.correct,
      allCompleted: this.done && this.index >= this.missions.length,
    };
  }
}
