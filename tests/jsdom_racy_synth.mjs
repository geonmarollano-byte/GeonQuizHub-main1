/**
 * GEON'S GAMEHUB - tests/jsdom_racy_synth.mjs
 * Hostile-synth integration test for the AI Reader.
 *
 * Real browsers (Chrome family + Firefox) are documented to silently DROP an
 * utterance passed to speechSynthesis.speak() when it is called synchronously
 * right after speechSynthesis.cancel(). The game's cancel-first policy
 * (cancel previous speech before every question/feedback) hits exactly that
 * pattern, which made the normal quiz question inaudible on affected engines
 * even though plain test doubles recorded everything.
 *
 * This test boots the REAL script.js against the REAL index.html in jsdom
 * with a synth double that reproduces the bug deterministically (every other
 * speak attempt is silently swallowed, exposes native-style state/events so
 * the reader's watchdog logic engages) and proves:
 *
 *   1. the active NORMAL QUIZ question is eventually spoken for multiple
 *      levels (watchdog recovery, spoken from the question data),
 *   2. "Excellent!" / "Incorrect." / "Time's up." all survive the drop-race,
 *   3. dropped utterances are retried at most once (no duplicate spam),
 *   4. story/problem content also recovers,
 *   5. no uncaught errors occur.
 *
 * Exits non-zero on failure.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import jsdomPkg from 'jsdom';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  if (!/Could not parse CSS/i.test(err.message)) errors.push(`jsdomError: ${err.message}`);
});
virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

let html = readFileSync(path.join(root, 'index.html'), 'utf8');
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
  setTimeout(resolve, 3000);
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
try {
  globalThis.navigator = dom.window.navigator;
} catch {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
}
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.Node = dom.window.Node;

/**
 * Hostile synth: looks native (getVoices + speaking/pending), but every odd
 * speak attempt is silently swallowed (never fires events, never speaks) to
 * model the cancel()->speak() drop bug. Even attempts speak "normally".
 */
const speech = { accepted: [], dropped: [], log: [], cancels: 0, attempts: 0 };
globalThis.speechSynthesis = {
  speaking: false,
  pending: false,
  getVoices: () => [{ name: 'Hostile Test Voice', lang: 'en-US' }],
  cancel() {
    speech.cancels += 1;
    this.speaking = false;
    this.pending = false;
  },
  resume() {},
  speak(utter) {
    speech.attempts += 1;
    if (speech.attempts % 2 === 1) {
      speech.dropped.push(utter.text); // the real-browser bug: utterance vanishes
      speech.log.push(utter.text);
      return;
    }
    speech.accepted.push(utter.text);
    speech.log.push(utter.text);
    this.speaking = true;
    const self = this;
    setTimeout(() => {
      if (utter.onstart) utter.onstart();
      self.speaking = false;
      if (utter.onend) utter.onend();
    }, 8);
  },
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
/** Production watchdog runs at 400ms - wait for it + event dispatch slack. */
const waitForSpeech = () => wait(600);

await import('../script.js');
await wait(150);

assert.ok(dom.window.GEON, 'window.GEON not exposed');
assert.equal(dom.window.GEON.ready(), true, 'banks not ready');

dom.window.GEON.settings.update({ reader: true });

// INTRO -> MOTTO -> HOME -> SUBJECT -> LEVELS (all silent)
click('#intro-enter');
click('#motto-continue');
assert.equal(active(), 'screen-home');
click('.tile-play');
click('.subject-card'); // MATH
click('#subjects-continue');
click('.level-cell.next');
assert.equal(active(), 'screen-quiz');
let engine = dom.window.GEON.engine();
const q1 = engine.current.question.question;
await waitForSpeech();
// WITHOUT watchdog recovery the first utterance was silently dropped; WITH
// it the question is re-spoken exactly once by the guarded retry
assert.equal(speech.dropped.length, 1, 'the drop-race partner must fire first (hostile model sanity)');
assert.equal(speech.accepted.at(-1), q1, 'quiz level 1 question recovered by the watchdog');
assert.equal(speech.accepted.length, 1, 'question heard once (no duplicate spam)');

// Correct answer at level 1 -> "Excellent!" survives the drop-race
const clickAnswer = (eng, correct) => {
  const target = correct ? eng.current.answer : null;
  const btns = Array.from(dom.window.document.querySelectorAll('#quiz-choices .choice-btn'));
  const btn = btns.find((b) => {
    const t = b.querySelector('.choice-text').textContent;
    return correct ? t === target : t !== eng.current.answer;
  });
  click(btn);
};
clickAnswer(engine, true);
await waitForSpeech();
assert.equal(speech.accepted.at(-1), 'Excellent!', 'correct feedback recovered by the watchdog');

// NEXT -> level 2 question spoken from question data
click('#quiz-next');
await waitForSpeech();
engine = dom.window.GEON.engine();
assert.equal(engine.currentLevel, 2, 'did not advance to level 2');
assert.equal(speech.accepted.at(-1), engine.current.question.question, 'level 2 question recovered');

// NEXT-after-correct burst for levels 3 and 4: EVERY level must recover
for (let level = 3; level <= 4; level += 1) {
  clickAnswer(engine, true);
  await waitForSpeech();
  assert.equal(speech.accepted.at(-1), 'Excellent!');
  click('#quiz-next');
  await waitForSpeech();
  engine = dom.window.GEON.engine();
  assert.equal(engine.currentLevel, level, `did not advance to level ${level}`);
  assert.equal(speech.accepted.at(-1), engine.current.question.question, `level ${level} question recovered`);
}

// Wrong answer -> "Incorrect." survives; same-question retry stays silent
const attemptsBeforeWrong = speech.log.length;
const currentQuestionBeforeWrong = engine.current.question.question;
clickAnswer(engine, false);
await waitForSpeech();
assert.equal(speech.accepted.at(-1), 'Incorrect.', 'wrong feedback recovered');
const attemptsAfterWrong = speech.log.slice(attemptsBeforeWrong);
assert.ok(
  !attemptsAfterWrong.includes(currentQuestionBeforeWrong),
  'same-question retry after the wait must not re-speak over feedback'
);

// Time-up -> "Time's up." survives
engine.handleTimeout();
await waitForSpeech();
assert.equal(speech.accepted.at(-1), "Time's up.", 'timeout feedback recovered');

// STORY flow with the hostile synth: passage + question recover
click('#quiz-quit');
await wait(80);
click('.overlay .btn-primary, .overlay button'); // confirm dialog OK button
await wait(80);
click('[data-nav="story-select"]');
click('.story-card');
assert.equal(active(), 'screen-story-reader');
await waitForSpeech();
assert.equal(speech.accepted.at(-1), $('#story-passage').textContent, 'story passage recovered');
click('#story-start-questions');
assert.equal(active(), 'screen-story-questions');
await waitForSpeech();
assert.equal(speech.accepted.at(-1), $('#story-question').textContent, 'story question recovered');
click('#story-choices .choice-btn');
await waitForSpeech();
assert.ok(['Excellent!', 'Incorrect.'].includes(speech.accepted.at(-1)), 'story answer feedback recovered');

// PROBLEM QUIZ (mission) flow with the hostile synth
click('[data-nav="story-select"]');
click('[data-nav="mission"]');
assert.equal(active(), 'screen-mission');
await waitForSpeech();
assert.equal(
  speech.accepted.at(-1),
  `${$('#mission-brief').textContent} ${$('#mission-question').textContent}`,
  'problem brief + question recovered'
);
const { MISSIONS } = await import('../src/mission/missionData.js');
const right = MISSIONS[0].answer;
const missionBtn = Array.from(dom.window.document.querySelectorAll('#mission-choices .choice-btn')).find(
  (b) => b.querySelector('.choice-text').textContent === right
);
click(missionBtn);
await waitForSpeech();
assert.equal(speech.accepted.at(-1), `${MISSIONS[1].brief} ${MISSIONS[1].question}`, 'mission 2 problem spoken after feedback');
assert.ok(speech.dropped.concat(speech.accepted).includes('Excellent!'), 'mission feedback attempted');

// Final invariants
assert.ok(speech.cancels >= speech.accepted.length + speech.dropped.length, 'cancel-before-speak invariant');
const dupes = speech.accepted.filter((t, i, arr) => arr[i - 1] === t && t.length > 30);
assert.deepEqual(dupes, [], 'no long text spoken twice back-to-back');
assert.deepEqual(errors, [], `uncaught errors: ${errors.slice(0, 3)}`);
console.log(
  `jsdom racy-synth: AI Reader recovered ${speech.accepted.length} utterances under the cancel->speak drop bug `
  + `(${speech.dropped.length} drops, ${speech.cancels} cancels) - normal quiz/story/problem/feedback all audible`
);
dom.window.close();
process.exit(0);
