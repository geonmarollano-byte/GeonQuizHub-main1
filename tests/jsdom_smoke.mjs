/**
 * GEON'S GAMEHUB - tests/jsdom_smoke.mjs
 * DOM smoke test: boots the REAL script.js against the REAL index.html inside
 * jsdom and clicks through the documented flows:
 *   intro -> motto -> home -> subjects -> levels -> quiz (answer + item)
 *   shop purchase, settings theme switch, questioner switch,
 *   daily challenge full run -> guarded reward.
 * Exits non-zero on any uncaught error or failed assertion.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import jsdomPkg from 'jsdom';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Serves the project files from disk under an http origin (needed for localStorage). */
const localInterceptor = requestInterceptor((request) => {
  try {
    const rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) return new Response('forbidden', { status: 403 });
    return new Response(readFileSync(filePath));
  } catch {
    return new Response('not found', { status: 404 });
  }
});

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (err) => {
  // CSS parsing limitations of jsdom are not app errors
  if (!/Could not parse CSS/i.test(err.message)) errors.push(`jsdomError: ${err.message}`);
});
virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

let html = readFileSync(path.join(root, 'index.html'), 'utf8');
// Remove the module tag: jsdom does not execute ES modules. We import
// script.js directly in Node with jsdom globals installed instead.
html = html.replace(/<script type="module" src="script\.js"><\/script>/, '');

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  resources: { interceptors: [localInterceptor] },
  pretendToBeVisual: true,
  virtualConsole,
});

await new Promise((resolve) => {
  dom.window.addEventListener('load', resolve);
  setTimeout(resolve, 3000); // safety net
});

// embedded banks must be present (loaded via plain <script src>)
assert.ok(dom.window.GEON_QUESTIONS_PREVIOUS, 'embedded previous bank missing');
assert.equal(dom.window.GEON_QUESTIONS_PREVIOUS.questions.length, 800);
assert.ok(dom.window.GEON_QUESTIONS_NEW, 'embedded new bank missing');

// Install jsdom globals so script.js can run in Node context
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
// Node >= 21 ships its own getter-only global navigator; rebind safely.
try {
  globalThis.navigator = dom.window.navigator;
} catch {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
}
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.Node = dom.window.Node;

// AI Reader test double: jsdom has no speechSynthesis, so script.js binds to
// this stub. It records every utterance (and every cancel) the game speaks.
const speech = { utterances: [], cancels: 0 };
globalThis.speechSynthesis = {
  cancel: () => { speech.cancels += 1; },
  speak: (u) => speech.utterances.push(u.text),
};
globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
  constructor(text) { this.text = String(text); }
};

const $ = (sel) => dom.window.document.querySelector(sel);
const click = (sel) => {
  const node = typeof sel === 'string' ? $(sel) : sel;
  assert.ok(node, `missing element: ${sel}`);
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
};
const active = () => dom.window.document.querySelector('.screen.active').id;
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

await import('../script.js');
await wait(150); // async boot (bank loading via embedded fallback)

assert.ok(dom.window.GEON, 'window.GEON not exposed');
assert.equal(dom.window.GEON.ready(), true, 'banks not ready');
assert.equal(active(), 'screen-intro');

// Enable the AI Reader for the whole run - the stub records every utterance.
dom.window.GEON.settings.update({ reader: true });

// INTRO -> MOTTO -> HOME
click('#intro-enter');
assert.equal(active(), 'screen-motto');
click('#motto-continue');
assert.equal(active(), 'screen-home');
assert.equal($('#hud-coins').textContent, '0');
// AI READER: intro/motto/home navigation must speak NOTHING (no menus, tiles,
// titles, coins or buttons are ever read)
assert.equal(speech.utterances.length, 0, 'AI reader must not read menus/navigation');

// HOME -> SUBJECTS -> LEVELS -> QUIZ
click('.tile-play');
assert.equal(active(), 'screen-subjects');
assert.equal(dom.window.document.querySelectorAll('.subject-card').length, 5);
click('.subject-card'); // MATH
click('#subjects-continue');
assert.equal(active(), 'screen-levels');
assert.equal(dom.window.document.querySelectorAll('.level-cell').length, 80);
// AI READER: subject/level selection screens stay silent
assert.equal(speech.utterances.length, 0, 'AI reader must not read subject/level screens');
click('.level-cell.next');
assert.equal(active(), 'screen-quiz');
await wait(20);
assert.ok($('#quiz-choices .choice-btn'), 'quiz choices not rendered');
assert.equal($('#quiz-lives').textContent, '❤️'.repeat(8));
// AI READER: entering the quiz speaks exactly the question (no lives, score,
// streak, timer or item buttons)
assert.equal(speech.utterances.length, 1, 'quiz entry must speak exactly once');
assert.equal(speech.utterances[0], $('#quiz-question').textContent, 'quiz entry must speak the question');

// Answer the first question correctly using the live engine state
let engine = dom.window.GEON.engine();
const answerText = engine.current.answer;
const correctBtn = Array.from(dom.window.document.querySelectorAll('#quiz-choices .choice-btn')).find(
  (b) => b.querySelector('.choice-text').textContent === answerText
);
click(correctBtn);
assert.ok($('#quiz-feedback').classList.contains('good'), 'correct feedback missing');
// AI READER: correct answer -> "Excellent!" (and nothing else re-spoken)
assert.equal(speech.utterances.at(-1), 'Excellent!', 'correct answer must speak "Excellent!"');
assert.equal(speech.utterances.length, 2);
assert.equal(engine.currentLevel, 1);
click('#quiz-next');
assert.equal(engine.currentLevel, 2, 'did not advance to level 2');
// AI READER: the new question replaces the previous speech (cancel + speak)
assert.equal(speech.utterances.length, 3, 'NEXT must speak exactly the new question');
assert.equal(speech.utterances.at(-1), $('#quiz-question').textContent);
assert.ok(speech.cancels >= speech.utterances.length, 'every utterance must cancel the previous first');
assert.equal($('#hud-coins').textContent, '5', 'coins not credited');

// Wrong answer path: lose a life
const wrongBtn = Array.from(dom.window.document.querySelectorAll('#quiz-choices .choice-btn')).find(
  (b) => b.querySelector('.choice-text').textContent !== engine.current.answer
);
click(wrongBtn);
assert.equal(engine.lives, 7, 'life not lost on wrong answer');
// AI READER: wrong answer -> "Incorrect."; the engine's automatic retry of
// the SAME question must NOT re-speak it over the feedback
assert.equal(speech.utterances.at(-1), 'Incorrect.', 'wrong answer must speak "Incorrect."');
assert.equal(speech.utterances.length, 4, 'retry must not re-speak the question');

// Time-up path: simulate the question timer expiring (what QuizTimer calls)
engine.handleTimeout();
assert.equal(engine.lives, 6, 'timeout must cost a life');
assert.equal(speech.utterances.at(-1), "Time's up.", 'timeout must speak "Time\'s up."');
assert.equal(speech.utterances.length, 5, 'timeout retry must not re-speak the question');

// Item flow: buy a 50/50 in the shop, use it in the quiz
dom.window.GEON.state.addCoins(1000);
click('[data-nav="shop"]');
assert.equal(active(), 'screen-shop');
// AI READER: the Shop screen (items, prices, coins) is never read
assert.equal(speech.utterances.length, 5, 'shop screen must stay silent');
assert.equal(dom.window.document.querySelectorAll('.shop-item').length, 5);
const buyButtons = Array.from(dom.window.document.querySelectorAll('.shop-item .btn'))
  .filter((b) => b.textContent === 'BUY');
click(buyButtons[3]); // 50/50 (order matches SHOP_ITEMS)
assert.equal(dom.window.GEON.state.itemCount('fifty_fifty'), 1);
assert.equal(speech.utterances.length, 5, 'purchases must stay silent');
// back to the quiz screen (back button returns through history) and use the item
dom.window.GEON.state.save();
click('[data-back]'); // shop -> quiz
assert.equal(active(), 'screen-quiz');
// AI READER: returning to the quiz re-speaks its (still current) question
assert.equal(speech.utterances.length, 6, 'quiz re-entry must speak the question once');
assert.equal(speech.utterances.at(-1), $('#quiz-question').textContent);
const ffBtn = dom.window.document.querySelector('[data-item="fifty_fifty"]');
assert.equal(ffBtn.disabled, false, 'fifty_fifty button should be enabled');
click(ffBtn);
engine = dom.window.GEON.engine();
assert.equal(engine.current.eliminated.length, 2, '50/50 did not eliminate two choices');
assert.equal(dom.window.GEON.state.itemCount('fifty_fifty'), 0, 'item not consumed');
assert.equal(speech.utterances.length, 6, 'item usage must stay silent');

// SETTINGS: theme + questioner switching
click('[data-nav="menu"]');
click('[data-nav="settings"]');
assert.equal(active(), 'screen-settings');
// AI READER: menu and settings screens are never read
assert.equal(speech.utterances.length, 6, 'menu/settings must stay silent');
click('[data-theme-set="dark"]');
assert.equal(dom.window.document.documentElement.getAttribute('data-theme'), 'dark');
click('[data-theme-set="light"]');
assert.equal(dom.window.document.documentElement.getAttribute('data-theme'), 'light');
click('[data-questioner="new"]');
assert.equal(dom.window.GEON.settings.get('questioner'), 'new');
click('[data-questioner="previous"]');
click('[data-theme-set="original"]');
assert.equal(speech.utterances.length, 6, 'settings interactions must stay silent');

// DAILY CHALLENGE: full 10-question run -> guarded reward
click('[data-nav="home"]');
click('[data-nav="daily"]');
assert.equal(active(), 'screen-daily');
click('#daily-start');
assert.equal(active(), 'screen-quiz');
await wait(20);
engine = dom.window.GEON.engine();
assert.equal(engine.questions.length, 10, 'daily must have 10 questions');
// AI READER: daily challenge questions are read like every other quiz level
assert.equal(speech.utterances.length, 7, 'daily entry must speak the question once');
assert.equal(speech.utterances.at(-1), $('#quiz-question').textContent);
const dailyIds = [];
for (let i = 0; i < 10; i += 1) {
  dailyIds.push(engine.current.question.id);
  const ans = engine.current.answer;
  const btn = Array.from(dom.window.document.querySelectorAll('#quiz-choices .choice-btn')).find(
    (b) => b.querySelector('.choice-text').textContent === ans
  );
  click(btn);
  await wait(5);
  // AI READER: rapid answer + next changes never duplicate speech
  assert.equal(speech.utterances.at(-1), 'Excellent!');
  click('#quiz-next'); // also finishes the run after question 10
  await wait(5);
  engine = dom.window.GEON.engine();
  if (i < 9) assert.equal(speech.utterances.at(-1), $('#quiz-question').textContent, `daily Q${i + 2} must be spoken`);
}
await wait(200); // completion + reward hooks
assert.equal(active(), 'screen-daily-results');
// AI READER: results screens stay silent; the last spoken line is the final
// "Excellent!" of question 10 (10 daily + 1 from the normal quiz before)
assert.equal(speech.utterances.at(-1), 'Excellent!');
assert.equal(speech.utterances.filter((t) => t === 'Excellent!').length, 11);
assert.ok($('#daily-results-body').textContent.includes('Daily reward'), 'daily reward line missing');
const dailyKeys = Object.keys(dom.window.GEON.state.daily);
assert.equal(dailyKeys.length, 1);
assert.equal(dom.window.GEON.state.daily[dailyKeys[0]].rewardClaimed, true);

// Determinism check: same date+questioner -> same 10 ids
const { buildDaily } = await import('../src/data/dailyChallenge.js');
const banks = dom.window.GEON.banks;
const today = dailyKeys[0].split('::')[0];
const rebuilt = buildDaily(banks.previous, 'previous', today);
const rebuiltIds = rebuilt.questions.map((q) => q.id);
if (JSON.stringify(rebuiltIds) !== JSON.stringify(dailyIds)) {
  console.error('MISMATCH daily:', JSON.stringify(dailyIds), 'vs', JSON.stringify(rebuiltIds));
  process.exit(2);
}
assert.equal(JSON.stringify(rebuiltIds), JSON.stringify(dailyIds));
assert.equal(Array.isArray(dailyIds) && Object.getPrototypeOf(dailyIds) === Array.prototype, true);

// STORY flow smoke - full run with rewards
click('[data-nav="home"]');
click('[data-nav="story-select"]');
assert.equal(dom.window.document.querySelectorAll('.story-card').length, 10);
const utterBeforeStory = speech.utterances.length;
click('.story-card');
assert.equal(active(), 'screen-story-reader');
assert.ok($('#story-passage').textContent.length > 400);
// AI READER: opening a story speaks the story passage (content) only
assert.equal(speech.utterances.length, utterBeforeStory + 1, 'story open must speak the passage once');
assert.equal(speech.utterances.at(-1), $('#story-passage').textContent);
click('#story-start-questions');
assert.equal(active(), 'screen-story-questions');
// AI READER: the story question is spoken on screen entry
assert.equal(speech.utterances.length, utterBeforeStory + 2);
assert.equal(speech.utterances.at(-1), $('#story-question').textContent);
for (let i = 0; i < 5; i += 1) {
  await wait(10);
  assert.equal(dom.window.document.querySelectorAll('#story-choices .choice-btn').length, 4, 'story choices not rendered');
  // answer (any choice - the app validates and shows feedback either way)
  click('#story-choices .choice-btn');
  await wait(5);
  // AI READER: answer feedback phrase (never the question again)
  assert.ok(['Excellent!', 'Incorrect.'].includes(speech.utterances.at(-1)), 'story answer must speak feedback');
  const nextBtn = $('#story-next');
  assert.equal(nextBtn.classList.contains('hidden'), false, 'story next should appear after answering');
  click('#story-next');
  await wait(5);
}
assert.equal(active(), 'screen-story-results');
// AI READER: exactly 1 passage + 5 questions + 5 feedback phrases were spoken;
// the results screen stays silent
assert.equal(speech.utterances.length, utterBeforeStory + 11, 'story run speech must not duplicate');
assert.ok($('#story-results-body').textContent.length > 10);

// REVIEWER flow smoke - answer one question, then quit
click('[data-nav="home"]');
click('[data-nav="reviewer"]');
assert.equal(active(), 'screen-reviewer');
const utterBeforeReviewer = speech.utterances.length;
click('#reviewer-start');
assert.equal(active(), 'screen-reviewer-quiz');
assert.ok($('#reviewer-question').textContent.length > 10);
// AI READER: reviewer questions are spoken on entry (setup screens are not)
assert.equal(speech.utterances.length, utterBeforeReviewer + 1);
assert.equal(speech.utterances.at(-1), $('#reviewer-question').textContent);
click('#reviewer-choices .choice-btn');
await wait(5);
assert.ok($('#reviewer-feedback').textContent.length > 5, 'reviewer feedback missing');
assert.ok(['Excellent!', 'Incorrect.'].includes(speech.utterances.at(-1)), 'reviewer answer must speak feedback');
assert.equal($('#reviewer-next').classList.contains('hidden'), false);
click('#reviewer-quit');
assert.equal(active(), 'screen-reviewer');
// AI READER: quitting back to the setup screen speaks nothing
assert.equal(speech.utterances.length, utterBeforeReviewer + 2);

// MISSION flow - full 5-mission run
click('[data-nav="home"]');
const utterBeforeMission = speech.utterances.length;
click('[data-nav="mission"]');
assert.equal(active(), 'screen-mission');
const { MISSIONS } = await import('../src/mission/missionData.js');
// AI READER: the problem (mission) content + its question are spoken together
assert.equal(speech.utterances.length, utterBeforeMission + 1, 'mission entry must speak brief + question');
assert.equal(speech.utterances.at(-1), `${$('#mission-brief').textContent} ${$('#mission-question').textContent}`);
for (let m = 0; m < 5; m += 1) {
  await wait(10);
  const current = MISSIONS[m];
  const rightBtn = Array.from(dom.window.document.querySelectorAll('#mission-choices .choice-btn')).find(
    (b) => b.querySelector('.choice-text').textContent === current.answer
  );
  assert.ok(rightBtn, `mission ${m + 1} correct choice not rendered`);
  click(rightBtn);
  await wait(20);
  // AI READER: correct answer -> "Excellent!" followed by the next problem's
  // brief + question (the last mission is followed by the silent results screen)
  const lastTwo = speech.utterances.slice(-2);
  assert.ok(lastTwo.includes('Excellent!'), `mission ${m + 1} correct must speak "Excellent!"`);
}
await wait(150);
assert.equal(active(), 'screen-mission-results');
// 1 entry read + 4 x (feedback + next problem) + 1 final feedback = 10 lines
assert.equal(speech.utterances.length, utterBeforeMission + 10, 'mission run speech must not duplicate');
assert.equal(speech.utterances.at(-1), 'Excellent!');
assert.equal(dom.window.GEON.state.missions.runsCompleted, 1);
assert.ok($('#mission-results-body').textContent.includes('5 / 5'));

// AI READER: final sanity - every utterance was preceded by a cancel, so no
// feedback and question speech ever overlapped
assert.ok(speech.cancels >= speech.utterances.length, 'cancel-before-speak invariant violated');

// POINTS CONVERSION
click('[data-nav="home"]');
click('[data-nav="convert"]');
assert.equal(active(), 'screen-convert');
const coinsBefore = dom.window.GEON.state.economy.coins;
dom.window.GEON.state.addPoints(20);
$('#convert-amount').value = '2';
$('#convert-amount').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
click('#convert-confirm');
await wait(10);
assert.equal(dom.window.GEON.state.economy.coins, coinsBefore + 10, 'conversion did not grant coins');

// PROFILE + CODE PANEL
click('[data-nav="home"]');
click('[data-nav="profile"]');
assert.equal(active(), 'screen-profile');
click('#profile-open-code');
assert.equal(active(), 'screen-code');
$('#code-name').value = 'Test Pilot';
click('#code-save');
await wait(10);
assert.equal(dom.window.GEON.state.profile.name, 'Test Pilot');
assert.equal(active(), 'screen-profile');

// GAME OVER path: lose all 8 lives on a normal quiz run
click('[data-nav="home"]');
click('.tile-play');
click('.subject-card'); // MATH
click('#subjects-continue');
assert.equal(active(), 'screen-levels');
click('.level-cell.next');
assert.equal(active(), 'screen-quiz');
await wait(10);
engine = dom.window.GEON.engine();
const livesBefore = engine.lives;
const utterBeforeGameOver = speech.utterances.length;
for (let i = 0; i < 8; i += 1) {
  engine = dom.window.GEON.engine();
  const wrongBtn = Array.from(dom.window.document.querySelectorAll('#quiz-choices .choice-btn')).find(
    (b) => b.querySelector('.choice-text').textContent !== engine.current.answer
  );
  click(wrongBtn);
  await wait(10);
}
// AI READER: the first 7 losing answers each spoke "Incorrect." and the
// automatic same-question retries never re-spoke the question. The 8th
// (fatal) answer skips feedback entirely - the engine goes straight to
// GAME_OVER, mirroring the on-screen behavior.
const gameOverWrongCount = speech.utterances.slice(utterBeforeGameOver).filter((t) => t === 'Incorrect.').length;
assert.equal(gameOverWrongCount, 7, 'each non-fatal losing answer must speak "Incorrect." once');
assert.equal(active(), 'screen-gameover');
assert.equal(dom.window.GEON.state.getPass('previous', 'MATH', 'SUBJECT 1').completedLevels, 0, 'pass not reset after game over');
// AI READER: the game-over screen itself is never read. The baseline was
// captured after the entry question was spoken, so only the 7 non-fatal
// "Incorrect." lines may follow.
assert.equal(speech.utterances.length, utterBeforeGameOver + 7, 'game over must add only the 7 feedback lines');
click('#gameover-retry');
await wait(10);
assert.equal(active(), 'screen-quiz');
assert.equal(dom.window.GEON.engine().currentLevel, 1, 'retry must restart at level 1');
// AI READER: retrying speaks the new run's first question
assert.equal(speech.utterances.at(-1), $('#quiz-question').textContent);

// No uncaught errors during the whole run
assert.deepEqual(errors, [], `uncaught errors: ${errors.slice(0, 3)}`);
console.log(`jsdom smoke: real DOM flows OK (quiz/items/shop/settings/daily/story/reviewer/mission/profile/game-over); AI reader spoke ${speech.utterances.length} targeted utterances (${speech.cancels} cancels)`);
dom.window.close();
process.exit(0);
