/**
 * GEON'S GAMEHUB - script.js
 * Main controller / composition root. All game logic lives in the src/
 * modules (per the blueprint's modular architecture); this file wires the
 * DOM to those modules and owns screen flow:
 *
 *   OPEN -> INTRO/MOTTO -> HOME -> MODE SELECTION
 *   Normal Quiz: HOME -> SUBJECT -> QUIZ TYPE -> LEVEL -> QUIZ -> ... -> VICTORY
 *   Reviewer:    HOME -> REVIEWER -> SUBJECT -> QUESTIONER -> FILTER -> REVIEW -> RESULTS
 *   Daily:       HOME -> DAILY -> 10 QUESTIONS -> RESULTS -> DAILY REWARD
 *   Story:       HOME -> STORY -> SELECTION -> READING -> QUESTIONS -> RESULTS
 *   Mission:     HOME -> MISSION -> 5 MISSIONS -> RESULTS -> MISSION REWARD
 */
import { GAME, passKey, milestoneForStreak } from './src/gameCore.js';
import { GeonStorage } from './src/state/storage.js';
import { SettingsState } from './src/state/settingsState.js';
import { GameState } from './src/state/gameState.js';
import { CATALOG, SUBJECT_META, topicsFor, verifyDistribution } from './src/data/subjectCatalog.js';
import { loadBank, pathQuestions } from './src/data/questionLoader.js';
import { validateBank } from './src/data/questionValidator.js';
import { buildDaily, dailyStateKey, todayKey } from './src/data/dailyChallenge.js';
import { QuizEngine, ENGINE_STATES } from './src/quiz/quizEngine.js';
import { buildSession, validateLevelSelection } from './src/quiz/sessionBuilder.js';
import {
  applyAnswerReward,
  claimDailyCompletion,
  claimStoryBase,
  claimStoryPerfect,
  claimAllStoriesBonus,
  claimMissionReward,
  claimAllMissionsBonus,
} from './src/economy/rewards.js';
import * as shop from './src/economy/shop.js';
import { ACHIEVEMENTS, evaluate as evaluateAchievements, levelMilestoneLabel } from './src/progression/achievements.js';
import { allStats } from './src/progression/subjectStats.js';
import { TITLES, titleFor, nextTitle } from './src/progression/titles.js';
import { describeStreak } from './src/progression/streaks.js';
import { MissionRun } from './src/mission/mission.js';
import { STORIES, storyCount } from './src/story/storyData.js';
import { StoryRun } from './src/story/storyQuiz.js';
import { AudioManager } from './src/audio/audioManager.js';
import { AIReader } from './src/accessibility/reader.js';
import { Router } from './src/ui/router.js';
import { el, clear, setText, renderChoices, setBar } from './src/ui/render.js';
import { Notifier } from './src/ui/notifications.js';
import { OverlayManager } from './src/ui/overlays.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const storage = new GeonStorage();
const settings = new SettingsState(storage);
const state = new GameState(storage);
const audio = new AudioManager({ settings });
const notifier = new Notifier($('toasts'));
const overlays = new OverlayManager($('overlay'));

const router = new Router({
  screens: document.querySelectorAll('.screen'),
  onChange: (id) => {
    applyHudVisibility(id);
    announceScreen(id);
    audio.playSfx('click');
    updateHud();
    // Refresh the quiz item bar when returning to an active quiz (e.g. after
    // buying items in the Shop) so counts/enabled states are never stale.
    if (id === 'quiz' && engine) updateItemCounts();
    if (settings.get('reader')) {
      // AI Reader: a screen change always cancels speech in flight, then
      // speaks ONLY the new screen's explicitly targeted readable content
      // (data-ai-reader="true": quiz question, story passage, mission brief
      // + question...). Screens without readable content stay silent.
      reader.stop();
      reader.readCurrentScreen();
    }
  },
});

const reader = new AIReader({
  settings,
  getActiveScreen: () => router.current,
});

/**
 * AI Reader change announcer + duplicate-speech guard. Tracks the readable
 * content that was last announced so re-renders, retries (the engine
 * re-presents the SAME question after a wrong answer or Second Chance),
 * timers and state changes never speak the same content twice. The first
 * announcement of a screen's content is owned by the router's onChange
 * above; this helper speaks only when the content changes while the screen
 * is already active (e.g. clicking NEXT loads a new question).
 *
 * When it speaks, it speaks `text` DIRECTLY from the live game data (the
 * active question / story question / mission brief + question supplied by
 * the exact function that just rendered it) - never scraped from the
 * surrounding UI. If no text is supplied it falls back to the screen's
 * explicitly marked data-ai-reader content only.
 */
let lastAnnouncedKey = null;
function announceContentChange(screenId, key, text) {
  if (key === lastAnnouncedKey) return false;
  lastAnnouncedKey = key;
  const active = router.current && router.current.id === `screen-${screenId}`;
  if (!active) return false;
  return reader.speakActiveContent(text);
}

/** Active question banks: { previous: [...], new: [...] } */
const banks = { previous: [], new: [] };
let banksReady = false;

/** Transient UI selections. */
const ui = {
  subject: null,
  quizType: 'SUBJECT 1',
  startLevel: 1,
  reviewerSubject: 'MATH',
  reviewerQuestioner: null,
  reviewerTopic: 'ALL',
  reviewerQueue: [],
  reviewerIndex: 0,
  reviewerCorrect: 0,
  lastRunScore: 0,
};

// ---------------------------------------------------------------------------
// Themes / HUD
// ---------------------------------------------------------------------------
function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.get('theme'));
}

function updateHud() {
  setText('hud-coins', state.economy.coins);
  setText('hud-points', state.economy.points);
}

function applyHudVisibility(screenId) {
  const hud = $('hud');
  const hideOn = new Set(['intro', 'motto', 'quiz']);
  hud.style.display = hideOn.has(screenId) ? 'none' : 'flex';
}

function announceScreen(screenId) {
  const srStatus = $('sr-status');
  if (srStatus) srStatus.textContent = `${screenId.replace(/-/g, ' ')} screen`;
}

// ---------------------------------------------------------------------------
// Question loading
// ---------------------------------------------------------------------------
async function loadBanks() {
  const results = await Promise.all([
    loadBank({ questioner: 'previous' }),
    loadBank({ questioner: 'new' }),
  ]);
  for (const res of results) {
    banks[res.questioner] = res.questions;
    for (const w of res.warnings) console.warn(`[questions/${res.questioner}]`, w);
  }
  banksReady = true;
  const errors = [
    ...verifyDistribution(banks.previous).map((e) => `previous: ${e}`),
    ...verifyDistribution(banks.new).map((e) => `new: ${e}`),
  ];
  if (errors.length) console.warn('[questions] distribution issues:', errors.slice(0, 10));
  return results;
}

function activeBank() {
  return banks[settings.get('questioner')] || [];
}

// ---------------------------------------------------------------------------
// Home / navigation
// ---------------------------------------------------------------------------
function renderHome() {
  setText('home-name', state.profile.name);
  setText('home-avatar', state.profile.avatar);
  const total = state.totalCompletedLevels(settings.get('questioner'));
  const title = titleFor(total);
  setText('home-title', `${title.icon} ${title.title}`);
  setText('home-questioner', settings.get('questioner').toUpperCase());
  updateHud();
}

function refreshAfterChange() {
  renderHome();
  updateHud();
  state.save();
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.nav;
    if (target === 'subjects') renderSubjects();
    if (target === 'shop') renderShop();
    if (target === 'inventory') renderInventory();
    if (target === 'profile') renderProfile();
    if (target === 'convert') renderConvert();
    if (target === 'leaderboards') renderLeaderboards();
    if (target === 'titles') renderTitles();
    if (target === 'achievements') renderAchievements();
    if (target === 'reviewer') renderReviewerSetup();
    if (target === 'story-select') renderStoryList();
    if (target === 'daily') renderDaily();
    if (target === 'mission') startMissionRun();
    if (target === 'home') renderHome();
    router.show(target);
  });
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => router.back());
});

$('hud-menu-btn').addEventListener('click', () => router.show('menu'));
$('hud-reader-btn').addEventListener('click', () => {
  if (!settings.get('reader')) {
    notifier.toast('Enable AI Reader in Settings first', { kind: 'bad' });
    return;
  }
  reader.readVisibleScreenFromUserGesture();
});

// ---------------------------------------------------------------------------
// Intro / Motto
// ---------------------------------------------------------------------------
$('intro-enter').addEventListener('click', () => {
  audio.playMusic('motto');
  router.show('motto');
});

$('motto-continue').addEventListener('click', () => {
  renderHome();
  router.show('home');
  audio.playMusic('home');
});

// ---------------------------------------------------------------------------
// Subjects / quiz type / levels
// ---------------------------------------------------------------------------
function renderSubjects() {
  const list = clear($('subject-list'));
  for (const subject of GAME.SUBJECTS) {
    const meta = SUBJECT_META[subject];
    const completed = state.subjectCompletedLevels(settings.get('questioner'), subject);
    const card = el(
      'button',
      {
        class: `subject-card${ui.subject === subject ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => {
          ui.subject = subject;
          renderSubjects();
          $('subjects-continue').disabled = false;
        },
      },
      [
        el('span', { class: 'subject-icon', text: meta.icon }),
        el('span', {}, [
          el('span', { class: 'subject-name', text: subject }),
          el('br'),
          el('span', { class: 'subject-blurb', text: meta.blurb }),
        ]),
        el('span', { class: 'subject-progress', text: `${completed}/160 done` }),
      ]
    );
    list.appendChild(card);
  }
  $('quiz-type-1').classList.toggle('is-selected', ui.quizType === 'SUBJECT 1');
  $('quiz-type-2').classList.toggle('is-selected', ui.quizType === 'SUBJECT 2');
  $('subjects-continue').disabled = !ui.subject;
}

$('quiz-type-1').addEventListener('click', () => {
  ui.quizType = 'SUBJECT 1';
  renderSubjects();
});
$('quiz-type-2').addEventListener('click', () => {
  ui.quizType = 'SUBJECT 2';
  renderSubjects();
});

$('subjects-continue').addEventListener('click', () => {
  if (!ui.subject) return;
  renderLevels();
  router.show('levels');
});

function renderLevels() {
  setText('levels-title', `${ui.subject} · ${ui.quizType}`);
  const grid = clear($('level-grid'));
  const pass = state.getPass(settings.get('questioner'), ui.subject, ui.quizType);
  const unlocked = Math.min(pass.completedLevels + 1, GAME.LEVELS_PER_PATH);
  for (let lv = 1; lv <= GAME.LEVELS_PER_PATH; lv += 1) {
    const done = lv <= pass.completedLevels;
    const isNext = lv === unlocked;
    const locked = lv > unlocked;
    const cell = el(
      'button',
      {
        class: `level-cell${done ? ' done' : ''}${isNext ? ' next' : ''}${locked ? ' locked' : ''}`,
        type: 'button',
        role: 'listitem',
        disabled: locked,
        'aria-label': `Level ${lv}${done ? ' (completed)' : locked ? ' (locked)' : ''}`,
        text: String(lv),
        onclick: () => {
          if (locked) return;
          ui.startLevel = lv;
          startNormalQuiz();
        },
      }
    );
    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------------
// Quiz (Normal + Daily share the screen; engines differ by mode)
// ---------------------------------------------------------------------------
let engine = null;
let quizContext = null; // {mode, questioner, subject, quizType, dailyKey}

function livesHtml(lives) {
  if (!Number.isFinite(lives)) return '∞';
  return '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, GAME.START_LIVES - lives));
}

function setQuizFeedback(html, kind) {
  const node = $('quiz-feedback');
  node.className = `quiz-feedback${kind ? ` ${kind}` : ''}`;
  node.innerHTML = html;
}

function updateQuizHud() {
  if (!engine) return;
  setText('quiz-lives', livesHtml(engine.lives));
  $('quiz-lives').setAttribute('aria-label', `${engine.lives} lives remaining`);
  setText('quiz-score', engine.score);
  setText('quiz-streak', engine.streak);
  updateItemCounts();
}

function updateItemCounts() {
  document.querySelectorAll('#quiz-items .item-btn').forEach((btn) => {
    const id = btn.dataset.item;
    const count = state.itemCount(id);
    btn.querySelector('b').textContent = count;
    btn.disabled = count <= 0 || !engine || engine.state !== ENGINE_STATES.ANSWERING;
  });
}

function startNormalQuiz() {
  const questioner = settings.get('questioner');
  const pass = state.getPass(questioner, ui.subject, ui.quizType);
  const check = validateLevelSelection(ui.startLevel, pass);
  if (!check.ok) {
    notifier.toast(`Level locked. Unlocked up to ${check.unlocked || pass.completedLevels + 1}.`, { kind: 'bad' });
    return;
  }
  const session = buildSession({
    questions: activeBank(),
    subject: ui.subject,
    quizType: ui.quizType,
    startLevel: check.level,
    usedIds: [],
  });
  if (!session.questions.length) {
    notifier.toast('No questions available for this path.', { kind: 'bad' });
    return;
  }
  quizContext = { mode: 'normal', questioner, subject: ui.subject, quizType: ui.quizType };
  bootEngine('normal', session.questions, {
    subject: ui.subject,
    quizType: ui.quizType,
    startLevel: check.level,
  });
  setText('quiz-mode-tag', `${ui.subject} · ${ui.quizType}`);
  setText('quiz-level', `LVL ${check.level}`);
  router.show('quiz');
  audio.playMusic('game');
}

function bootEngine(mode, questions, opts = {}) {
  if (engine) engine.destroy();
  const questioner = quizContext.questioner;
  engine = new QuizEngine({
    mode,
    questions,
    subject: opts.subject,
    quizType: opts.quizType,
    startLevel: opts.startLevel,
    hooks: {
      onQuestion: ({ question, choices, level }) => {
        setText('quiz-question', question.question);
        renderChoices($('quiz-choices'), choices, {
          onSelect: (choice) => submitAnswer(choice),
        });
        setQuizFeedback('', '');
        $('quiz-next').classList.add('hidden');
        if (level) setText('quiz-level', `LVL ${level}`);
        updateQuizHud();
        // AI Reader: speak the question DIRECTLY from the question data on
        // in-screen question changes (screen entry is announced by the
        // router). The key guard keeps the engine's automatic same-question
        // retry from cutting off the spoken answer feedback.
        announceContentChange('quiz', `quiz:${question.id ?? question.question}`, question.question);
      },
      onTick: (remaining) => {
        const total = Math.max(1, engine.mode.secondsPerQuestion);
        setBar($('quiz-timer-bar'), remaining / total);
        $('quiz-timer-bar').classList.toggle('low', remaining <= 10);
        $('quiz-timer-bar').parentElement.setAttribute('aria-valuenow', String(remaining));
      },
      onCorrect: ({ reward, level, streak }) => {
        reader.speakFeedback('correct');
        audio.playSfx('correct');
        if (quizContext.mode === 'normal') {
          applyAnswerReward(state, reward);
          state.recordAnswer(questioner, quizContext.subject, true);
          state.recordLevelComplete(questioner, quizContext.subject, quizContext.quizType, level, engine.score);
          state.save();
        }
        const milestone = milestoneForStreak(streak);
        setQuizFeedback(
          `✅ Correct! +${reward.score} pts score · +${reward.coins} 🪙 · +${reward.points} 🎯${milestone ? `<span class="expl">🔥 ${milestone.name}!</span>` : ''}`,
          'good'
        );
        markChoiceStates(true);
        updateHud();
        updateQuizHud();
        $('quiz-next').classList.remove('hidden');
        $('quiz-next').focus();
      },
      onWrong: ({ livesLeft, timedOut }) => {
        reader.speakFeedback(timedOut ? 'timeout' : 'wrong');
        audio.playSfx('wrong');
        if (quizContext.mode === 'normal') state.recordAnswer(questioner, quizContext.subject, false);
        setQuizFeedback(
          `${timedOut ? "⏰ Time's up!" : '❌ Wrong answer!'} ${Number.isFinite(livesLeft) ? `${livesLeft} lives left.` : ''}<span class="expl">The correct answer is highlighted. Try again!</span>`,
          'bad'
        );
        markChoiceStates(false);
        updateQuizHud();
      },
      onSecondChance: () => {
        // The attempted answer was wrong, so the spoken feedback is the
        // documented wrong-answer phrase; the retry below must NOT re-speak
        // the question over it (guarded in onQuestion).
        reader.speakFeedback('wrong');
        notifier.toast('🔁 Second Chance used — no life lost!', { kind: 'good' });
        setQuizFeedback('🔁 Second Chance! Try this question again.', 'good');
      },
      onMilestone: ({ milestone }) => {
        notifier.toast(`🔥 ${milestone.name}! +${milestone.score} score${milestone.coins ? ` +${milestone.coins} 🪙` : ''}${milestone.points ? ` +${milestone.points} 🎯` : ''}`, { kind: 'good', ms: 3200 });
      },
      onLevelMilestone: ({ level }) => {
        const label = levelMilestoneLabel(level);
        if (label) overlays.milestone(label);
      },
      onLevelComplete: ({ level }) => {
        ui.lastRunScore = engine.score;
        setText('quiz-level', `LVL ${level + 1 <= GAME.LEVELS_PER_PATH ? level + 1 : 80} ✓`);
      },
      onVictory: (summary) => finishRun('victory', summary),
      onGameOver: (summary) => finishRun('gameover', summary),
      onComplete: (summary) => {
        if (quizContext.mode === 'daily') finishRun('daily', summary);
        else finishRun('victory', summary);
      },
      canUseSecondChance: () => {
        if (state.itemCount('second_chance') <= 0) return false;
        state.useItem('second_chance');
        state.save();
        updateItemCounts();
        return true;
      },
    },
  });
  $('quiz-timer-bar').parentElement.classList.toggle('hidden', engine.mode.secondsPerQuestion <= 0);
  $('quiz-items').classList.toggle('hidden', false);
  engine.start();
  if (engine.state !== ENGINE_STATES.ANSWERING && engine.state !== ENGINE_STATES.QUESTION_READY) {
    // empty session edge case - hooks already fired
  }
}

function markChoiceStates(correct) {
  if (!engine || !engine.current) return;
  const answer = engine.current.answer;
  document.querySelectorAll('#quiz-choices .choice-btn').forEach((btn) => {
    const text = btn.querySelector('.choice-text').textContent;
    btn.disabled = true;
    if (text === answer) btn.classList.add('correct');
    else if (!correct && btn.classList.contains('picked')) btn.classList.add('wrong');
  });
}

function submitAnswer(choice) {
  if (!engine) return;
  const result = engine.answer(choice);
  if (!result.accepted) return;
  const pickedBtn = Array.from(document.querySelectorAll('#quiz-choices .choice-btn')).find(
    (b) => b.querySelector('.choice-text').textContent === choice
  );
  if (pickedBtn) pickedBtn.classList.add('picked');
  // In reviewer-less flows the engine already emitted hooks. For the wrong +
  // retry case the engine re-presents the question automatically.
  if (result.outcome === 'correct' || result.outcome === 'victory') {
    // wait for NEXT
  }
}

$('quiz-next').addEventListener('click', () => {
  if (!engine) return;
  engine.advance();
});

document.querySelectorAll('#quiz-items .item-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!engine || engine.state !== ENGINE_STATES.ANSWERING) return;
    const id = btn.dataset.item;
    if (state.itemCount(id) <= 0) {
      notifier.toast('You do not have that item. Visit the Shop!', { kind: 'bad' });
      return;
    }
    if (id === 'second_chance') {
      if (engine.secondChanceArmed) {
        notifier.toast('Second Chance is already armed for this question.', { kind: 'info' });
        return;
      }
      state.useItem(id);
      state.save();
      engine.useItem(id);
      notifier.toast('🔁 Second Chance armed — it will trigger on your next wrong answer.', { kind: 'good' });
      updateItemCounts();
      return;
    }
    if (!state.useItem(id)) return;
    const res = engine.useItem(id);
    if (!res.ok) {
      state.addItem(id); // refund - effect could not apply
      notifier.toast(`Cannot use that right now (${res.reason}).`, { kind: 'bad' });
      return;
    }
    state.save();
    audio.playSfx('click');
    if (id === 'hint') setQuizFeedback(`💡 Hint: ${res.hint}`, 'good');
    if (id === 'fifty_fifty') {
      document.querySelectorAll('#quiz-choices .choice-btn').forEach((b) => {
        const text = b.querySelector('.choice-text').textContent;
        if (res.removed.includes(text)) {
          b.classList.add('eliminated');
          b.disabled = true;
        }
      });
      notifier.toast('✂️ 50/50 — two wrong choices removed!', { kind: 'good' });
    }
    if (id === 'time_boost') notifier.toast('⏱️ +10 seconds added!', { kind: 'good' });
    if (id === 'life_token') notifier.toast(`❤️ +1 life (${engine.lives})`, { kind: 'good' });
    updateQuizHud();
  });
});

$('quiz-quit').addEventListener('click', async () => {
  const ok = await overlays.confirm({
    title: 'Quit quiz?',
    message: 'Progress on completed levels is saved. Your run score ends here.',
    okLabel: 'Quit',
  });
  if (!ok) return;
  if (engine) engine.destroy();
  engine = null;
  router.show('home');
  renderHome();
  audio.playMusic('home');
});

// ---------------------------------------------------------------------------
// Run endings (game over / victory / daily)
// ---------------------------------------------------------------------------
function finishRun(kind, summary) {
  const questioner = quizContext ? quizContext.questioner : settings.get('questioner');
  state.recordPlay(questioner, summary.subject || ui.subject, summary.score, summary.bestStreak);
  const newAchv = evaluateAchievements(state, questioner, summary);
  state.save();
  updateHud();
  audio.stopMusic();

  if (kind === 'gameover') {
    if (summary.resetPass && quizContext && quizContext.mode === 'normal') {
      state.resetPass(questioner, quizContext.subject, quizContext.quizType);
      state.save();
    }
    setText('gameover-text', quizContext && quizContext.mode === 'daily'
      ? 'Out of lives! No daily reward this time — try again tomorrow.'
      : 'You ran out of lives. This path resets to Level 1 — try again!');
    renderSummaryInto($('gameover-stats'), summary);
    router.show('gameover');
    audio.playMusic('home');
  } else if (kind === 'victory') {
    setText('victory-title', summary.mode === 'normal' ? 'VICTORY!' : 'COMPLETE!');
    setText('victory-text', summary.mode === 'normal'
      ? `You conquered all ${GAME.LEVELS_PER_PATH} levels of ${summary.subject} · ${summary.quizType}!`
      : 'Session complete!');
    renderSummaryInto($('victory-stats'), summary);
    state.submitScore({ name: state.profile.name, subject: summary.subject || 'OVERALL', score: summary.score, correct: summary.correct, total: summary.answered });
    state.save();
    router.show('victory');
    audio.playMusic('victory');
  } else if (kind === 'daily') {
    renderDailyResults(summary, true);
    router.show('daily-results');
    audio.playMusic('home');
  }

  for (const achv of newAchv) {
    overlays.achievement({ name: achv.name, description: achv.description, icon: achv.icon });
  }
  engine = null;
}

$('gameover-retry').addEventListener('click', () => {
  if (quizContext && quizContext.mode === 'daily') {
    renderDaily();
    router.show('daily');
  } else {
    ui.startLevel = 1;
    startNormalQuiz();
  }
});

function renderSummaryInto(node, summary) {
  clear(node);
  const rows = [
    ['Score', summary.score],
    ['Correct answers', `${summary.correct} / ${summary.correct + summary.wrong}`],
    ['Best streak', `${summary.bestStreak} (${describeStreak(summary.bestStreak)})`],
    ['Coins earned', summary.coinsEarned],
    ['Points earned', summary.pointsEarned],
  ];
  if (summary.levelsCompleted) rows.splice(3, 0, ['Levels completed', summary.levelsCompleted]);
  for (const [label, value] of rows) {
    node.appendChild(el('div', { class: 'stat-row' }, [el('span', { text: label }), el('b', { text: String(value) })]));
  }
}

// ---------------------------------------------------------------------------
// Daily Challenge
// ---------------------------------------------------------------------------
function renderDaily() {
  const dateStr = todayKey();
  const questioner = settings.get('questioner');
  setText('daily-date', dateStr);
  const key = dailyStateKey(dateStr, questioner);
  const entry = state.daily[key];
  const status = $('daily-status');
  status.classList.toggle('claimed', Boolean(entry && entry.rewardClaimed));
  if (entry && entry.rewardClaimed) {
    status.textContent = '✅ Completed today — reward claimed. Come back tomorrow!';
    $('daily-start').disabled = true;
  } else {
    status.textContent = 'Ready to play!';
    $('daily-start').disabled = false;
  }
}

$('daily-start').addEventListener('click', () => {
  const dateStr = todayKey();
  const questioner = settings.get('questioner');
  const dailyKey = dailyStateKey(dateStr, questioner);
  const daily = buildDaily(activeBank(), questioner, dateStr);
  if (!daily.questions.length) {
    notifier.toast('Question bank not loaded yet — try again in a moment.', { kind: 'bad' });
    return;
  }
  state.daily[dailyKey] = state.daily[dailyKey] || { completed: false, rewardClaimed: false, score: 0, correct: 0 };
  quizContext = { mode: 'daily', questioner, dailyKey, subject: 'OVERALL' };
  bootEngine('daily', daily.questions, {});
  setText('quiz-mode-tag', 'DAILY CHALLENGE');
  setText('quiz-level', 'Q1 / 10');
  router.show('quiz');
  audio.playMusic('game');
});

function renderDailyResults(summary, completed) {
  const body = clear($('daily-results-body'));
  body.appendChild(el('span', { class: 'big', text: `${summary.correct} / ${summary.total} correct` }));
  body.appendChild(el('div', { text: `Score: ${summary.score}` }));
  const questioner = quizContext ? quizContext.questioner : settings.get('questioner');
  const dailyKey = quizContext ? quizContext.dailyKey : null;
  if (completed && dailyKey) {
    state.daily[dailyKey].completed = true;
    state.daily[dailyKey].score = Math.max(state.daily[dailyKey].score || 0, summary.score);
    state.daily[dailyKey].correct = Math.max(state.daily[dailyKey].correct || 0, summary.correct);
    const reward = claimDailyCompletion(state, dailyKey);
    if (reward) {
      body.appendChild(el('div', { class: 'reward-line', text: `🎁 Daily reward: +${reward.points} points, +${reward.coins} coins` }));
      state.submitScore({ name: state.profile.name, subject: 'OVERALL', score: summary.score, correct: summary.correct, total: summary.total });
    } else {
      body.appendChild(el('div', { class: 'dim', text: 'Daily reward already claimed for today.' }));
    }
    state.save();
    updateHud();
  } else {
    body.appendChild(el('div', { class: 'dim', text: 'Challenge failed — no reward this time. A new challenge arrives tomorrow.' }));
  }
}

// ---------------------------------------------------------------------------
// Reviewer Mode
// ---------------------------------------------------------------------------
function renderReviewerSetup() {
  ui.reviewerQuestioner = ui.reviewerQuestioner || settings.get('questioner');
  const subjectWrap = clear($('reviewer-subjects'));
  for (const subject of GAME.SUBJECTS) {
    subjectWrap.appendChild(
      el('button', {
        class: `btn btn-chip${ui.reviewerSubject === subject ? ' is-selected' : ''}`,
        type: 'button',
        text: subject,
        onclick: () => {
          ui.reviewerSubject = subject;
          ui.reviewerTopic = 'ALL';
          renderReviewerSetup();
        },
      })
    );
  }
  document.querySelectorAll('[data-rq]').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.rq === ui.reviewerQuestioner);
    btn.onclick = () => {
      ui.reviewerQuestioner = btn.dataset.rq;
      renderReviewerSetup();
    };
  });
  const topicWrap = clear($('reviewer-topics'));
  topicWrap.appendChild(
    el('button', {
      class: `btn btn-chip${ui.reviewerTopic === 'ALL' ? ' is-selected' : ''}`,
      type: 'button',
      text: 'ALL TOPICS',
      onclick: () => {
        ui.reviewerTopic = 'ALL';
        renderReviewerSetup();
      },
    })
  );
  for (const { topic } of topicsFor(ui.reviewerSubject)) {
    topicWrap.appendChild(
      el('button', {
        class: `btn btn-chip${ui.reviewerTopic === topic ? ' is-selected' : ''}`,
        type: 'button',
        text: topic,
        onclick: () => {
          ui.reviewerTopic = topic;
          renderReviewerSetup();
        },
      })
    );
  }
}

$('reviewer-start').addEventListener('click', () => {
  const bank = banks[ui.reviewerQuestioner] || [];
  let pool = bank.filter((q) => q.subject === ui.reviewerSubject);
  if (ui.reviewerTopic !== 'ALL') pool = pool.filter((q) => q.topic === ui.reviewerTopic);
  if (!pool.length) {
    notifier.toast('No questions for this filter.', { kind: 'bad' });
    return;
  }
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  ui.reviewerQueue = shuffled.slice(0, GAME.REVIEWER_ROUND_SIZE);
  ui.reviewerIndex = 0;
  ui.reviewerCorrect = 0;
  // Render BEFORE showing so the AI Reader announces this run's first
  // question (via the router's onChange), never the previous run's leftovers.
  renderReviewerQuestion();
  router.show('reviewer-quiz');
  audio.playMusic('game');
});

function renderReviewerQuestion() {
  const q = ui.reviewerQueue[ui.reviewerIndex];
  if (!q) {
    finishReviewer();
    return;
  }
  setText('reviewer-progress', `${ui.reviewerIndex + 1} / ${ui.reviewerQueue.length}`);
  setText('reviewer-question', q.question);
  const choices = q.choices.slice().sort(() => Math.random() - 0.5);
  renderChoices($('reviewer-choices'), choices, {
    onSelect: (choice, btn) => answerReviewer(choice, btn, q),
  });
  clear($('reviewer-feedback'));
  $('reviewer-next').classList.add('hidden');
  // AI Reader: speak the reviewer question (from the question data) on
  // in-screen question changes.
  announceContentChange('reviewer-quiz', `reviewer:${q.id ?? q.question}`, q.question);
}

function answerReviewer(choice, btn, q) {
  const correct = choice === q.answer;
  if (correct) ui.reviewerCorrect += 1;
  reader.speakFeedback(correct ? 'correct' : 'wrong');
  document.querySelectorAll('#reviewer-choices .choice-btn').forEach((b) => {
    const text = b.querySelector('.choice-text').textContent;
    b.disabled = true;
    if (text === q.answer) b.classList.add('correct');
  });
  if (!correct) btn.classList.add('wrong');
  audio.playSfx(correct ? 'correct' : 'wrong');
  const fb = $('reviewer-feedback');
  fb.className = `quiz-feedback ${correct ? 'good' : 'bad'}`;
  fb.innerHTML = `${correct ? '✅ Correct!' : '❌ Not quite.'}<span class="expl">${q.explanation}</span>`;
  $('reviewer-next').classList.remove('hidden');
  $('reviewer-next').focus();
}

$('reviewer-next').addEventListener('click', () => {
  ui.reviewerIndex += 1;
  renderReviewerQuestion();
});

$('reviewer-quit').addEventListener('click', () => {
  audio.playMusic('home');
  router.show('reviewer');
});

function finishReviewer() {
  const total = ui.reviewerQueue.length;
  state.recordReview(ui.reviewerQuestioner, ui.reviewerSubject, total);
  state.submitScore({
    name: state.profile.name,
    subject: ui.reviewerSubject,
    score: ui.reviewerCorrect * 10,
    correct: ui.reviewerCorrect,
    total,
  });
  state.save();
  const body = clear($('reviewer-results-body'));
  body.appendChild(el('span', { class: 'big', text: `${ui.reviewerCorrect} / ${total}` }));
  const pct = total ? Math.round((ui.reviewerCorrect / total) * 100) : 0;
  body.appendChild(el('div', { text: `Accuracy: ${pct}% · ${ui.reviewerSubject} · ${ui.reviewerTopic}` }));
  body.appendChild(el('div', { class: 'dim', text: 'Reviewer mode is for practice — no lives, coins, or level progress are used.' }));
  router.show('reviewer-results');
  audio.playMusic('home');
}

$('reviewer-again').addEventListener('click', () => {
  $('reviewer-start').click();
});

// ---------------------------------------------------------------------------
// Story Quiz (state isolated from the normal quiz)
// ---------------------------------------------------------------------------
let storyRun = null;

function renderStoryList() {
  const list = clear($('story-list'));
  STORIES.forEach((story, i) => {
    const entry = state.story.completed[story.id];
    const done = entry && entry.baseClaimed;
    const perfect = entry && entry.perfectClaimed;
    list.appendChild(
      el(
        'button',
        {
          class: `story-card${done ? ' done' : ''}${perfect ? ' perfect' : ''}`,
          type: 'button',
          onclick: () => openStory(story.id),
        },
        [
          el('div', { class: 'story-title', text: `${i + 1}. ${story.title}` }),
          el('div', { class: 'story-meta', text: perfect ? '⭐ Perfect!' : done ? '✅ Completed' : '5 questions' }),
        ]
      )
    );
  });
}

function openStory(storyId) {
  const story = STORIES.find((s) => s.id === storyId);
  if (!story) return;
  setText('story-reader-title', story.title);
  setText('story-passage', story.passage);
  storyRun = new StoryRun({
    storyId,
    onReward: (kind, id) => {
      let reward = null;
      if (kind === 'base') reward = claimStoryBase(state, id);
      if (kind === 'perfect') reward = claimStoryPerfect(state, id);
      if (kind === 'all') reward = claimAllStoriesBonus(state, storyCount());
      if (reward) state.save();
      updateHud();
      return reward;
    },
  });
  router.show('story-reader');
  audio.playMusic('home');
}

$('story-start-questions').addEventListener('click', () => {
  if (!storyRun) return;
  renderStoryQuestion();
  router.show('story-questions');
});

function renderStoryQuestion() {
  const q = storyRun.currentQuestion;
  if (!q) {
    showStoryResults();
    return;
  }
  setText('story-progress', `${storyRun.index + 1} / ${storyRun.total}`);
  setText('story-qtype', q.type.toUpperCase());
  setText('story-question', q.question);
  const choices = q.choices.slice().sort(() => Math.random() - 0.5);
  renderChoices($('story-choices'), choices, {
    onSelect: (choice, btn) => answerStory(choice, btn, q),
  });
  clear($('story-feedback'));
  $('story-next').classList.add('hidden');
  // AI Reader: speak the story question (from the question data) on
  // in-screen question changes. The story passage itself is announced when
  // the story-reader screen opens (router onChange reads the marked
  // #story-passage).
  announceContentChange('story-questions', `story:${storyRun.story.id}:${storyRun.index}`, q.question);
}

function answerStory(choice, btn, q) {
  const result = storyRun.answer(choice);
  reader.speakFeedback(result.correct ? 'correct' : 'wrong');
  document.querySelectorAll('#story-choices .choice-btn').forEach((b) => {
    const text = b.querySelector('.choice-text').textContent;
    b.disabled = true;
    if (text === q.answer) b.classList.add('correct');
  });
  if (!result.correct) btn.classList.add('wrong');
  audio.playSfx(result.correct ? 'correct' : 'wrong');
  const fb = $('story-feedback');
  fb.className = `quiz-feedback ${result.correct ? 'good' : 'bad'}`;
  fb.innerHTML = `${result.correct ? '✅ Correct!' : '❌ Not quite.'}<span class="expl">${result.explanation}</span>`;
  $('story-next').classList.remove('hidden');
  $('story-next').textContent = result.finished ? 'SEE RESULTS →' : 'NEXT →';
  $('story-next').focus();
}

$('story-next').addEventListener('click', () => {
  if (storyRun && storyRun.done) showStoryResults();
  else renderStoryQuestion();
});

function showStoryResults() {
  const results = storyRun.results();
  const body = clear($('story-results-body'));
  body.appendChild(el('span', { class: 'big', text: `${results.correct} / ${results.total} — ${results.title}` }));
  if (results.rewards.baseReward) {
    body.appendChild(el('div', { class: 'reward-line', text: `🎁 Story complete: +${results.rewards.baseReward.points} 🎯 +${results.rewards.baseReward.coins} 🪙` }));
  } else {
    body.appendChild(el('div', { class: 'dim', text: 'Story reward already claimed for this story.' }));
  }
  if (results.perfect) {
    body.appendChild(el('div', { class: 'reward-line', text: results.rewards.perfectReward ? `⭐ Perfect bonus: +${results.rewards.perfectReward.points} 🎯 +${results.rewards.perfectReward.coins} 🪙` : '⭐ Perfect run! (bonus already claimed)' }));
  }
  if (results.rewards.allReward) {
    body.appendChild(el('div', { class: 'reward-line', text: `🏅 ALL STORIES COMPLETE: +${results.rewards.allReward.points} 🎯 +${results.rewards.allReward.coins} 🪙` }));
  }
  router.show('story-results');
  audio.playMusic('home');
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------
let missionRun = null;

function startMissionRun() {
  missionRun = new MissionRun({
    hooks: {
      onMission: () => renderMission(),
      onComplete: () => {
        state.save();
        renderMissionResults();
        router.show('mission-results');
        audio.playMusic('victory');
      },
    },
    onReward: (kind, index, run) => {
      let reward = null;
      if (kind === 'mission') reward = claimMissionReward(state, run, index);
      if (kind === 'all') reward = claimAllMissionsBonus(state, run);
      if (reward) {
        state.save();
        notifier.toast(`+${reward.points} 🎯 +${reward.coins} 🪙`, { kind: 'coin' });
      }
      updateHud();
      return reward;
    },
  });
  missionRun.start();
  router.show('mission');
  audio.playMusic('game');
}

function renderMission() {
  const mission = missionRun.current;
  setText('mission-step', `MISSION ${missionRun.index + 1} OF 5`);
  setText('mission-name', mission.name);
  setText('mission-subject', `${SUBJECT_META[mission.subject].icon} ${mission.subject}`);
  setText('mission-brief', mission.brief);
  setText('mission-question', mission.question);
  const choices = mission.choices.slice().sort(() => Math.random() - 0.5);
  renderChoices($('mission-choices'), choices, {
    onSelect: (choice, btn) => answerMission(choice, btn),
  });
  clear($('mission-feedback'));
  // AI Reader: speak the problem brief + question (from the mission data)
  // on in-screen changes. The key guard keeps the wrong-answer retry
  // (re-render of the same mission) from re-speaking the question over the
  // spoken feedback.
  announceContentChange('mission', `mission:${mission.id}`, `${mission.brief} ${mission.question}`);
}

function answerMission(choice, btn) {
  const mission = missionRun.current;
  const correct = choice === mission.answer;
  reader.speakFeedback(correct ? 'correct' : 'wrong');
  document.querySelectorAll('#mission-choices .choice-btn').forEach((b) => {
    const text = b.querySelector('.choice-text').textContent;
    if (text === mission.answer) {
      b.classList.add('correct');
    }
    b.disabled = true;
  });
  if (!correct) btn.classList.add('wrong');
  audio.playSfx(correct ? 'correct' : 'wrong');
  const fb = $('mission-feedback');
  fb.className = `quiz-feedback ${correct ? 'good' : 'bad'}`;
  fb.innerHTML = `${correct ? '✅ Mission complete!' : '❌ Not quite — read the explanation and try again.'}<span class="expl">${mission.explanation}</span>`;
  if (correct) {
    missionRun.answer(choice); // engine advances + rewards (guarded)
  } else {
    // allow retry on the same mission
    setTimeout(() => renderMission(), 2200);
  }
}

function renderMissionResults() {
  const summary = missionRun.summary;
  const body = clear($('mission-results-body'));
  body.appendChild(el('span', { class: 'big', text: `${summary.completed} / ${summary.total} MISSIONS` }));
  body.appendChild(el('div', { class: 'reward-line', text: summary.allCompleted ? '🏅 All missions bonus claimed: +250 🎯 +75 🪙' : 'Complete all 5 missions for the +250 🎯 +75 🪙 bonus.' }));
}

$('mission-again').addEventListener('click', () => startMissionRun());

// ---------------------------------------------------------------------------
// Shop / Inventory / Conversion
// ---------------------------------------------------------------------------
const ITEM_ICONS = { hint: '💡', fifty_fifty: '✂️', time_boost: '⏱️', life_token: '❤️', second_chance: '🔁' };

function renderShop() {
  const list = clear($('shop-list'));
  for (const item of shop.catalog()) {
    list.appendChild(
      el('div', { class: 'shop-item' }, [
        el('span', { class: 'shop-icon', text: ITEM_ICONS[item.id] || '🎁' }),
        el('span', {}, [
          el('div', { class: 'shop-name', text: item.name }),
          el('div', { class: 'shop-desc', text: item.description }),
        ]),
        el('span', { class: 'shop-right' }, [
          el('div', { class: 'shop-price', text: `${item.price} 🪙` }),
          el('button', {
            class: 'btn btn-chip',
            type: 'button',
            text: 'BUY',
            onclick: (e) => buyItem(item.id, e.currentTarget),
          }),
        ]),
      ])
    );
  }
  updateHud();
}

function buyItem(id, btn) {
  const res = shop.purchase(state, id, 1);
  if (!res.ok) {
    notifier.toast(res.reason === 'not enough coins' ? 'Not enough coins!' : res.reason, { kind: 'bad' });
    return;
  }
  state.save();
  audio.playSfx('click');
  notifier.toast(`Bought ${res.item.name}!`, { kind: 'good' });
  updateHud();
  renderShop();
  if (btn) btn.blur();
}

function renderInventory() {
  const list = clear($('inventory-list'));
  let any = false;
  for (const item of shop.catalog()) {
    const count = state.itemCount(item.id);
    list.appendChild(
      el('div', { class: 'shop-item' }, [
        el('span', { class: 'shop-icon', text: ITEM_ICONS[item.id] || '🎁' }),
        el('span', {}, [
          el('div', { class: 'shop-name', text: item.name }),
          el('div', { class: 'shop-desc', text: item.description }),
        ]),
        el('span', { class: 'shop-right' }, [el('div', { class: 'shop-owned', text: `×${count}` })]),
      ])
    );
    if (count > 0) any = true;
  }
  if (!any) {
    list.appendChild(el('div', { class: 'hint-text', text: 'No items yet — visit the Shop to buy some with your coins.' }));
  }
}

function renderConvert() {
  setText('convert-points', state.economy.points);
  setText('convert-coins', state.economy.coins);
  updateConvertPreview();
}

function updateConvertPreview() {
  const blocks = Math.max(0, Math.floor(Number($('convert-amount').value) || 0));
  const points = blocks * GAME.CONVERT_POINTS_BLOCK;
  const coins = blocks * GAME.CONVERT_COINS_BLOCK;
  const enough = state.economy.points >= points && blocks > 0;
  setText('convert-preview', enough ? `Preview: ${points} points → ${coins} coins` : `You need at least ${points} points for ${blocks} block(s).`);
  $('convert-confirm').disabled = !enough;
}

$('convert-amount').addEventListener('input', updateConvertPreview);

$('convert-confirm').addEventListener('click', () => {
  const blocks = Math.max(0, Math.floor(Number($('convert-amount').value) || 0));
  const res = state.convertPointsToCoins(blocks);
  if (!res.ok) {
    notifier.toast('Not enough points for that conversion.', { kind: 'bad' });
    return;
  }
  state.save();
  audio.playSfx('correct');
  notifier.toast(`Converted ${res.pointsSpent} 🎯 → ${res.coins} 🪙`, { kind: 'coin' });
  renderConvert();
  updateHud();
});

// ---------------------------------------------------------------------------
// Profile / Code panel
// ---------------------------------------------------------------------------
function renderProfile() {
  setText('profile-avatar', state.profile.avatar);
  setText('profile-name', state.profile.name);
  setText('profile-code', state.profile.code);
  const questioner = settings.get('questioner');
  const total = state.totalCompletedLevels(questioner);
  const title = titleFor(total);
  setText('profile-title', `${title.icon} ${title.title}`);
  const list = clear($('profile-stats'));
  let highest = 1;
  let current = 1;
  let bestScore = 0;
  for (const subject of GAME.SUBJECTS) {
    for (const quiz of GAME.QUIZ_TYPES) {
      const pass = state.getPass(questioner, subject, quiz);
      highest = Math.max(highest, pass.highestLevel);
      current = Math.max(current, Math.min(pass.completedLevels + 1, GAME.LEVELS_PER_PATH));
      bestScore = Math.max(bestScore, pass.bestScore);
    }
  }
  const rows = [
    ['Questioner', questioner.toUpperCase()],
    ['Highest level', highest],
    ['Current level', current],
    ['Highest score', bestScore],
    ['Current score', ui.lastRunScore],
    ['Coins', `${state.economy.coins} 🪙`],
    ['Points', `${state.economy.points} 🎯`],
    ['Levels completed (this questioner)', total],
  ];
  for (const [label, value] of rows) {
    list.appendChild(el('div', { class: 'stat-row' }, [el('span', { text: label }), el('b', { text: String(value) })]));
  }
  for (const s of allStats(state, questioner)) {
    list.appendChild(
      el('div', { class: 'stat-row' }, [
        el('span', { text: `${s.subject} accuracy` }),
        el('b', { text: `${s.accuracy}% (${s.correct}/${s.correct + s.wrong})` }),
      ])
    );
  }
}

$('profile-open-code').addEventListener('click', () => {
  $('code-name').value = state.profile.name;
  $('code-code').value = state.profile.code;
  $('code-avatar').value = state.profile.avatar;
  router.show('code');
});

$('code-save').addEventListener('click', () => {
  const name = $('code-name').value.trim().slice(0, 24) || 'Player';
  const code = $('code-code').value.trim().slice(0, 16) || 'GEON-0001';
  state.profile.name = name;
  state.profile.code = code;
  state.profile.avatar = $('code-avatar').value || '🦁';
  state.save();
  notifier.toast('Profile saved!', { kind: 'good' });
  renderProfile();
  router.show('profile');
});

// ---------------------------------------------------------------------------
// Leaderboards / Titles / Achievements
// ---------------------------------------------------------------------------
function renderLeaderboards() {
  const body = clear($('leaderboard-body'));
  if (!state.leaderboard.length) {
    body.appendChild(el('div', { class: 'hint-text', text: 'No scores yet — finish a quiz run to appear here. (Scores are stored locally in this browser.)' }));
    return;
  }
  state.leaderboard.slice(0, 10).forEach((entry, i) => {
    const pct = entry.total ? Math.round((entry.correct / entry.total) * 100) : 0;
    body.appendChild(
      el('div', { class: 'stat-row' }, [
        el('span', { text: `#${i + 1} ${entry.name} — ${entry.subject}` }),
        el('b', { text: `${entry.score} pts · ${pct}%` }),
      ])
    );
  });
}

function renderTitles() {
  const body = clear($('titles-body'));
  const total = state.totalCompletedLevels(settings.get('questioner'));
  const current = titleFor(total);
  const next = nextTitle(total);
  body.appendChild(
    el('div', { class: 'stat-row' }, [
      el('span', { text: 'Your rank' }),
      el('b', { text: `${current.icon} ${current.title} (${total} levels)` }),
    ])
  );
  if (next) {
    body.appendChild(
      el('div', { class: 'stat-row' }, [
        el('span', { text: 'Next title' }),
        el('b', { text: `${next.icon} ${next.title} at ${next.min} levels (${next.min - total} to go)` }),
      ])
    );
  }
  for (const tier of TITLES) {
    body.appendChild(
      el('div', { class: `stat-row title-row${total >= tier.min ? ' earned' : ''}` }, [
        el('span', { text: `${tier.icon} ${tier.title}` }),
        el('span', { class: 'dim', text: `${tier.min} levels` }),
      ])
    );
  }
}

function renderAchievements() {
  const body = clear($('achievements-body'));
  for (const achv of ACHIEVEMENTS) {
    const unlocked = state.hasAchievement(achv.id);
    body.appendChild(
      el('div', { class: `achv-cell${unlocked ? '' : ' locked'}` }, [
        el('div', { class: 'achv-icon', text: achv.icon }),
        el('div', { class: 'achv-name', text: achv.name }),
        el('div', { class: 'achv-desc', text: achv.description }),
      ])
    );
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  $('set-music').checked = settings.get('music');
  $('set-sound').checked = settings.get('sound');
  $('set-reader').checked = settings.get('reader');
  document.querySelectorAll('[data-questioner]').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.questioner === settings.get('questioner'));
  });
  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.themeSet === settings.get('theme'));
  });
}

$('set-music').addEventListener('change', (e) => {
  settings.update({ music: e.target.checked });
  audio.refresh();
  if (e.target.checked && router.current && router.current.id === 'screen-home') audio.playMusic('home');
});
$('set-sound').addEventListener('change', (e) => settings.update({ sound: e.target.checked }));
$('set-reader').addEventListener('change', (e) => {
  settings.update({ reader: e.target.checked });
  if (!e.target.checked) reader.stop();
  else reader.readCurrentScreen();
});

document.querySelectorAll('[data-questioner]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.update({ questioner: btn.dataset.questioner });
    renderSettings();
    renderHome();
    notifier.toast(`Questioner: ${btn.dataset.questioner.toUpperCase()}. Progress stays separate per questioner.`, { kind: 'info', ms: 3400 });
  });
});

document.querySelectorAll('[data-theme-set]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.update({ theme: btn.dataset.themeSet });
    applyTheme();
    renderSettings();
  });
});

// ---------------------------------------------------------------------------
// Menu: save export / import / backup / reset
// ---------------------------------------------------------------------------
function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('menu-export').addEventListener('click', () => {
  const data = storage.exportAll();
  download(`geons-gamehub-save-${Date.now()}.json`, JSON.stringify(data, null, 2));
  notifier.toast('Save exported!', { kind: 'good' });
});

$('menu-backup').addEventListener('click', () => {
  const key = storage.backup();
  notifier.toast(`Backup created (${key})`, { kind: 'good' });
});

$('menu-import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result = storage.importAll(payload);
    if (!result.ok) {
      notifier.toast(`Import rejected: ${result.errors[0]}`, { kind: 'bad', ms: 4000 });
      return;
    }
    notifier.toast(`Imported ${result.applied} entries. Reloading…`, { kind: 'good' });
    setTimeout(() => window.location.reload(), 900);
  } catch (err) {
    notifier.toast(`Import failed: ${err.message}`, { kind: 'bad', ms: 4000 });
  } finally {
    e.target.value = '';
  }
});

$('menu-reset').addEventListener('click', async () => {
  const ok = await overlays.confirm({
    title: 'Reset ALL game data?',
    message: 'This deletes progress, coins, points, items and settings in this browser. Export a save first if unsure.',
    okLabel: 'Delete everything',
  });
  if (!ok) return;
  for (const key of storage.keys()) storage.remove(key);
  notifier.toast('All data deleted. Reloading…', { kind: 'bad' });
  setTimeout(() => window.location.reload(), 900);
});

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err.message);
    });
  }
}

async function boot() {
  applyTheme();
  applyHudVisibility('intro');
  renderSettings();
  renderHome();
  updateHud();
  const results = await loadBanks();
  for (const res of results) {
    const validation = validateBank({ questioner: res.questioner, questions: res.questions });
    console.info(`[questions/${res.questioner}] ${res.questions.length} questions from ${res.source}${validation.ok ? '' : ` (${validation.errors.length} invalid records removed)`}`);
  }
  registerServiceWorker();
  router.show('intro', { pushHistory: false });
  // If the player already has progress, still show intro->motto->home flow.
  window.GEON = { state, settings, storage, banks, engine: () => engine, ready: () => banksReady };
}

boot();
