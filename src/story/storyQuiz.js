/**
 * GEON'S GAMEHUB - storyQuiz.js
 * Story quiz engine. Blueprint: story state is INTENTIONALLY ISOLATED from
 * the normal quiz state (separate run object - no shared lives/score/streak).
 * Flow: Story Library -> Select Story -> Read Story -> Questions -> Results.
 * Rewards: base completion +75 pts/+15 coins, perfect bonus +50 pts/+10 coins,
 * all-stories bonus +200 pts/+50 coins - each guarded so it claims once.
 */
import { STORIES, storyById, storyCount } from './storyData.js';

export class StoryRun {
  /**
   * @param {object} opts
   *   storyId:  story to play
   *   onReward: (kind:'base'|'perfect'|'all', storyId) => applied reward (caller grants, guarded)
   */
  constructor({ storyId, onReward } = {}) {
    this.story = storyById(storyId);
    this.onReward = onReward || (() => null);
    this.index = 0;
    this.correct = 0;
    this.answers = [];
    this.done = false;
  }

  get total() {
    return this.story ? this.story.questions.length : 0;
  }

  get currentQuestion() {
    if (!this.story || this.done) return null;
    return this.story.questions[this.index] || null;
  }

  /** Submit the answer for the current question; returns feedback. */
  answer(choice) {
    const q = this.currentQuestion;
    if (!q) return { accepted: false };
    const correct = choice === q.answer;
    if (correct) this.correct += 1;
    this.answers.push({ type: q.type, question: q.question, correct });
    this.index += 1;
    const finished = this.index >= this.total;
    if (finished) this.done = true;
    return {
      accepted: true,
      correct,
      type: q.type,
      explanation: q.explanation,
      answer: q.answer,
      finished,
    };
  }

  /** Final results + guarded reward claims (each fires at most once ever). */
  results() {
    if (!this.story) return null;
    const perfect = this.correct === this.total;
    const baseReward = this.onReward('base', this.story.id);
    const perfectReward = perfect ? this.onReward('perfect', this.story.id) : null;
    const allReward = this.onReward('all', this.story.id);
    return {
      storyId: this.story.id,
      title: this.story.title,
      correct: this.correct,
      total: this.total,
      perfect,
      answers: this.answers,
      rewards: { baseReward, perfectReward, allReward },
    };
  }
}

export { STORIES, storyById, storyCount };
