/**
 * GEON'S GAMEHUB - quizEngine.js
 * Quiz engine boundary - the documented Normal Quiz state machine:
 *
 *   IDLE -> START -> QUESTION_READY -> ANSWERING
 *     ANSWERING + CORRECT  -> REWARD -> NEXT (level complete)
 *     ANSWERING + WRONG/TIMEOUT -> SECOND_CHANCE? -> RETRY : LIFE_LOSS
 *     LIFE_LOSS (lives 0) -> GAME OVER (reset toward Level 1)
 *     LEVEL 80 complete -> VICTORY
 *
 * Rules implemented from the blueprint: 8 lives, 30s per question, streak
 * multipliers, streak milestones, item effects (Life Token cap 8, Time Boost
 * +10s, Hint, 50/50, Second Chance without double-counting), used-question
 * tracking, deterministic no-duplicate reward events (one onCorrect per
 * correct answer).
 *
 * The engine is DOM-free and storage-free: it emits events through hooks and
 * the caller (script.js) persists state. That keeps responsibilities clean
 * and prevents reward duplication.
 */
import { GAME } from '../gameCore.js';
import { computeAnswerReward } from './scoring.js';
import { QuizTimer } from './timer.js';
import { getMode } from './quizModes.js';

export const ENGINE_STATES = Object.freeze({
  IDLE: 'IDLE',
  QUESTION_READY: 'QUESTION_READY',
  ANSWERING: 'ANSWERING',
  REWARD: 'REWARD',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
  COMPLETE: 'COMPLETE',
});

export class QuizEngine {
  /**
   * @param {object} opts
   *   mode:        'normal' | 'daily' | 'reviewer'
   *   questions:   ordered question list for this session
   *   startLevel:  level of the first question (normal mode)
   *   subject/quizType: for event payloads
   *   hooks:       {onQuestion,onTick,onCorrect,onWrong,onSecondChance,onGameOver,
   *                 onVictory,onComplete,onLevelComplete,onMilestone,onLevelMilestone}
   *   timerFactory: optional (opts)=>QuizTimer (tests inject a manual timer)
   */
  constructor(opts = {}) {
    this.mode = getMode(opts.mode);
    this.questions = Array.isArray(opts.questions) ? opts.questions.slice() : [];
    this.subject = opts.subject || null;
    this.quizType = opts.quizType || null;
    this.hooks = opts.hooks || {};
    this.timerFactory = opts.timerFactory;

    this.state = ENGINE_STATES.IDLE;
    this.lives = this.mode.lives;
    this.score = 0;
    this.coinsEarned = 0;
    this.pointsEarned = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.index = -1;
    this.current = null; // { question, choices, answer, eliminated:[], answered:false, startedAt }
    this.usedIds = new Set();
    this.correctCount = 0;
    this.wrongCount = 0;
    this.levelsCompleted = 0;
    this.secondChanceArmed = false;
    this.perfectRun = true; // no wrong answers so far
    this.survivedRun = true; // never hit zero lives
    this.speedHit = false; // answered something within 5 seconds
    this.timer = null;
    this._startLevel = Math.max(1, Math.min(GAME.LEVELS_PER_PATH, Math.floor(opts.startLevel) || 1));
  }

  // ------------------------------------------------------------------
  get summary() {
    return {
      mode: this.mode.id,
      lives: this.lives,
      score: this.score,
      coinsEarned: this.coinsEarned,
      pointsEarned: this.pointsEarned,
      streak: this.streak,
      bestStreak: this.bestStreak,
      correct: this.correctCount,
      wrong: this.wrongCount,
      answered: this.correctCount + this.wrongCount,
      total: this.questions.length,
      levelsCompleted: this.levelsCompleted,
      perfectRun: this.perfectRun,
      survivedRun: this.survivedRun && this.correctCount > 0,
      speedHit: this.speedHit,
      subject: this.subject,
      quizType: this.quizType,
    };
  }

  start() {
    if (!this.questions.length) {
      this.state = ENGINE_STATES.COMPLETE;
      if (this.hooks.onComplete) this.hooks.onComplete(this.summary);
      return this;
    }
    this._nextQuestion();
    return this;
  }

  // ------------------------------------------------------------------
  _makeTimer() {
    const seconds = this.mode.secondsPerQuestion;
    if (!this.mode.timed || seconds <= 0) return null;
    const factory = this.timerFactory;
    if (factory) return factory({ seconds });
    return new QuizTimer({
      seconds,
      onTick: (remaining) => this.hooks.onTick && this.hooks.onTick(remaining),
      onTimeout: () => this.handleTimeout(),
    });
  }

  _shuffle(arr, rand = Math.random) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  _nextQuestion() {
    this.index += 1;
    if (this.index >= this.questions.length) {
      this._finishComplete();
      return;
    }
    const q = this.questions[this.index];
    this.usedIds.add(q.id);
    this.current = {
      question: q,
      choices: this._shuffle(q.choices),
      answer: q.answer,
      eliminated: [],
      answered: false,
      startedAt: Date.now(),
    };
    this.state = ENGINE_STATES.QUESTION_READY;
    if (this.timer) this.timer.stop();
    this.timer = this._makeTimer();
    if (this.hooks.onQuestion) {
      this.hooks.onQuestion({
        question: q,
        choices: this.current.choices,
        index: this.index,
        total: this.questions.length,
        level: this.mode.levelProgression ? this.currentLevel : null,
        timed: Boolean(this.timer),
      });
    }
    this.state = ENGINE_STATES.ANSWERING;
    if (this.timer) this.timer.start();
  }

  get currentLevel() {
    if (!this.mode.levelProgression || !this.current) return null;
    const lv = this.current.question.level;
    return typeof lv === 'number' ? lv : this._startLevel + this.index;
  }

  // ------------------------------------------------------------------
  /** Player submits an answer (choice text). Returns an event descriptor. */
  answer(choice) {
    if (this.state !== ENGINE_STATES.ANSWERING || !this.current || this.current.answered) {
      return { accepted: false, reason: 'not answering' };
    }
    if (!this.current.choices.includes(choice) || this.current.eliminated.includes(choice)) {
      return { accepted: false, reason: 'invalid choice' };
    }
    const secondsUsed = (Date.now() - this.current.startedAt) / 1000;
    if (secondsUsed <= GAME.SPEED_ANSWER_SECONDS) this.speedHit = true;
    this.current.answered = true;
    if (this.timer) this.timer.stop();

    if (choice === this.current.answer) {
      return this._resolveCorrect(secondsUsed);
    }
    return this._resolveWrong(secondsUsed, false);
  }

  handleTimeout() {
    if (this.state !== ENGINE_STATES.ANSWERING || !this.current || this.current.answered) return { accepted: false, reason: 'not answering' };
    this.current.answered = true;
    return this._resolveWrong(this.mode.secondsPerQuestion, true);
  }

  _resolveCorrect(secondsUsed) {
    this.state = ENGINE_STATES.REWARD;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.correctCount += 1;

    let reward = { score: 0, coins: 0, points: 0, milestone: null, multiplier: 1 };
    if (this.mode.rewards) {
      reward = computeAnswerReward(this.currentLevel, this.streak);
      this.score += reward.score;
      this.coinsEarned += reward.coins;
      this.pointsEarned += reward.points;
    }

    const level = this.currentLevel;
    if (this.hooks.onCorrect) {
      this.hooks.onCorrect({ reward, secondsUsed, level, streak: this.streak, summary: this.summary });
    }
    if (reward.milestone && this.hooks.onMilestone) {
      this.hooks.onMilestone({ streak: this.streak, milestone: reward.milestone });
    }

    // Level completion (normal mode) - one event per level, no duplicates.
    if (this.mode.levelProgression && level) {
      this.levelsCompleted += 1;
      if (this.hooks.onLevelComplete) this.hooks.onLevelComplete({ level, summary: this.summary });
      if (level % 5 === 0 && this.hooks.onLevelMilestone) {
        this.hooks.onLevelMilestone({ level, summary: this.summary });
      }
      if (level >= this.mode.victoryAtLevel) {
        this._finishVictory();
        return { accepted: true, outcome: 'victory', reward, level };
      }
    }
    return { accepted: true, outcome: 'correct', reward, level };
  }

  _resolveWrong(secondsUsed, timedOut) {
    this.perfectRun = false;
    // Second Chance item (documented flow): wrong answer -> item available?
    // -> retry without life loss, and prevent double-counting the original
    // failed attempt. The hook consumes the item from inventory if available.
    const offer = !this.secondChanceArmed && typeof this.hooks.canUseSecondChance === 'function'
      ? this.hooks.canUseSecondChance()
      : false;
    if (this.secondChanceArmed || offer) {
      this.secondChanceArmed = false;
      this.wrongCount += 1; // counted once, as a single failed attempt
      if (this.hooks.onSecondChance) {
        this.hooks.onSecondChance({ level: this.currentLevel, summary: this.summary });
      }
      this._retryCurrentQuestion();
      return { accepted: true, outcome: 'second_chance', timedOut, secondsUsed };
    }

    this.wrongCount += 1;
    this.streak = 0;
    if (Number.isFinite(this.lives)) {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.lives = 0;
        this.survivedRun = false;
        this._finishGameOver();
        return { accepted: true, outcome: 'game_over', timedOut, secondsUsed };
      }
    }
    if (this.hooks.onWrong) {
      this.hooks.onWrong({ livesLeft: this.lives, timedOut, secondsUsed, level: this.currentLevel, summary: this.summary });
    }
    this._retryCurrentQuestion();
    return { accepted: true, outcome: 'wrong', livesLeft: this.lives, timedOut, secondsUsed };
  }

  _retryCurrentQuestion() {
    this.index -= 1; // re-present the same question
    this.current = null;
    this._nextQuestion();
  }

  // ------------------------------------------------------------------
  /**
   * Use an item during the current question. The caller must already have
   * consumed the item from inventory (single source of truth for economy).
   */
  useItem(itemId) {
    if (!this.current || this.state !== ENGINE_STATES.ANSWERING) {
      return { ok: false, reason: 'no active question' };
    }
    switch (itemId) {
      case 'life_token': {
        if (!Number.isFinite(this.lives)) return { ok: false, reason: 'no lives in this mode' };
        if (this.lives >= GAME.MAX_LIVES) return { ok: false, reason: 'already at max lives' };
        this.lives += 1; // capped by the normal maximum (documented)
        return { ok: true, effect: 'life_token', lives: this.lives };
      }
      case 'time_boost': {
        if (!this.timer) return { ok: false, reason: 'timer not active' };
        const remaining = this.timer.addSeconds(GAME.TIME_BOOST_SECONDS);
        return { ok: true, effect: 'time_boost', remaining };
      }
      case 'hint': {
        const q = this.current.question;
        const hint = (q.hint && q.hint.trim()) || `This question is about ${q.topic} in ${q.subject}.`;
        return { ok: true, effect: 'hint', hint };
      }
      case 'fifty_fifty': {
        const wrong = this.current.choices.filter((c) => c !== this.current.answer && !this.current.eliminated.includes(c));
        if (wrong.length < 2) return { ok: false, reason: 'not enough wrong choices' };
        const removed = this._shuffle(wrong).slice(0, 2);
        this.current.eliminated.push(...removed);
        return { ok: true, effect: 'fifty_fifty', removed };
      }
      case 'second_chance': {
        if (this.secondChanceArmed) return { ok: false, reason: 'already armed' };
        this.secondChanceArmed = true;
        return { ok: true, effect: 'second_chance' };
      }
      default:
        return { ok: false, reason: 'unknown item' };
    }
  }

  /** Normal-mode "next level" progression after a correct answer. */
  advance() {
    if (this.state === ENGINE_STATES.REWARD) {
      this._nextQuestion();
    }
    return this;
  }

  // ------------------------------------------------------------------
  _finishVictory() {
    this.state = ENGINE_STATES.VICTORY;
    if (this.timer) this.timer.stop();
    if (this.hooks.onVictory) this.hooks.onVictory(this.summary);
  }

  _finishGameOver() {
    this.state = ENGINE_STATES.GAME_OVER;
    if (this.timer) this.timer.stop();
    // Blueprint: Game Over resets the path toward Level 1 and clears
    // used-question tracking. The engine reports; the caller persists.
    this.usedIds.clear();
    if (this.hooks.onGameOver) this.hooks.onGameOver({ ...this.summary, resetPass: this.mode.levelProgression });
  }

  _finishComplete() {
    this.state = this.mode.id === 'normal' ? ENGINE_STATES.VICTORY : ENGINE_STATES.COMPLETE;
    if (this.timer) this.timer.stop();
    if (this.hooks.onComplete) this.hooks.onComplete(this.summary);
  }

  /** Stop everything (leaving the quiz). */
  destroy() {
    if (this.timer) this.timer.stop();
    this.timer = null;
    this.state = ENGINE_STATES.IDLE;
  }
}
