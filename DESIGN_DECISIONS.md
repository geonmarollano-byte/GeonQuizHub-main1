# DESIGN DECISIONS — details the blueprint left open

The blueprint (audit + flow maps + inventory) is the single source of truth
for every rule, number and flow it documents. Where it did **not** specify a
minor implementation detail, the simplest safe option preserving documented
behavior was chosen and is recorded here. Nothing in this file overrides the
blueprint.

## 1. Question bank content (regeneration)

The original `questions.json` / `questions.new.json` were unrecoverable from
the corrupted archive. Both banks were regenerated to match the documented
distributions exactly (80 questions per path; topic counts per subject as
documented; 800 records per questioner).

- MATH content is procedurally generated (unique per questioner).
- Fact-based topics are drawn from curated educational pools; both questioners
  cover the same curriculum, but ids, records, choice order and most question
  texts differ (worded-question overlap between banks is kept under 30% and is
  asserted in `tests/questioner.test.js`).
- PSYCHOLOGY content follows the audit's guidance for age-appropriate,
  constructive educational framing (recognizing manipulation, resilience,
  honest persuasion, self-improvement).
- "DMA Procedures" (TECH 1) is taught as **Disassemble–Maintain–Assemble**
  procedures, matching the OHS context of the subject.

## 2. Economy detail: conversion rate

The blueprint documents the Points → Coins screen
(`POINTS -> Conversion Panel -> Select amount -> Preview -> Confirm`) but not
the rate. Implemented as **10 points = 5 coins per block** (2:1), selectable
in blocks with live preview. Constant: `GAME.CONVERT_POINTS_BLOCK /
CONVERT_COINS_BLOCK`.

## 3. Titles ladder

"Titles" are documented as progression tracking; exact tier names/levels were
not specified. Implemented as a ladder on **total completed levels of the
active questioner**: NOVICE 0, APPRENTICE 10, SCHOLAR 25, SPECIALIST 50,
EXPERT 100, MASTER 200, GRANDMASTER 400, GEON'S CHAMPION 800 (all 16 paths ×
80 levels).

## 4. Level ↔ question mapping

Each path has exactly 80 levels and 80 questions, so **level N presents
question N** of that path, with topics laid out in documented order
(e.g. MATH L1–15 Multiplication … L61–80 Problem Solving). Sessions align to
the selected level; used-question tracking prevents re-asking within a run and
is cleared on Game Over, as documented.

## 5. Retry semantics after a wrong answer

The flow map shows `WRONG -> SECOND_CHANCE? -> (NO) -> LIFE_LOSS`. When no
Second Chance item is used, the same question is re-presented (reshuffled
choices) after the life is lost. Second Chance (item) retries without life
loss and counts the failed attempt exactly once (no double counting), exactly
as documented.

## 6. Reviewer round size

Reviewer Mode is documented as practice with filters and explanations but no
round length was specified. A round is **10 random questions** from the
filtered pool (`GAME.REVIEWER_ROUND_SIZE`), with unlimited retries skipped —
each answer is followed by an explanation, then Next. Reviewer grants no
coins, points, lives or level progress; it records a per-subject `reviewed`
statistic only.

## 7. Mission retry semantics

The flow shows `Answer -> Correct/Wrong -> Explanation -> Next Mission`.
Implemented so a mission is completed by answering correctly (wrong answers
show the explanation and allow a retry); the +100/+20 reward is claimed once
per mission per run and +250/+75 once per completed run, via claim flags —
rewards can never duplicate.

## 8. Fifth mission name

Documented examples: The Supply Count (MATH), The Cooling Test (SCIENCE),
The Pressure Choice (PSYCHOLOGY), The Safe System Check (TECH 1). The TECH 2
mission is named **"The Network Line"** (implementation detail).

## 9. Game Over on Daily Challenge

Daily rules document 8 lives and completion reward protection. Running out of
lives ends the attempt **without** the daily reward (it was not completed);
the deterministic set stays the same for the day, and a fresh challenge
appears the next day.

## 10. Leaderboards

Client-side only, as the audit's engineering note requires (no backend is
documented). Best local runs are stored per subject with score and accuracy;
the UI formats names, scores and percentages.

## 11. Smoke screenshots

`tests/smoke-original.png`, `smoke-light.png`, `smoke-dark.png` are *outputs*
of the Playwright path in `tests/browser_smoke.py`. They are generated when
Playwright is installed rather than shipped as stale binaries.

## 12. AI Reader targeting contract

The AI Reader never scrapes visible screens (the original implementation read
all visible text/UI on every screen change, which was a defect). It speaks
**only** content that is explicitly targeted:

- The active content string handed to it by the renderers — the quiz question
  (Normal + Daily, every level, taken directly from the engine's question
  data in the `onQuestion` hook), the Reviewer question, the story passage +
  story question, and the mission/problem brief + question. For screen entry
  the router reads the same text from elements marked
  `data-ai-reader="true"`. Choices, menus, buttons, HUD, Shop, Inventory,
  Profile, Settings, points/coins, titles, achievements and results screens
  are never spoken.
- Fixed feedback phrases (spoken, not read from the DOM): correct →
  "Excellent!", wrong → "Incorrect.", time-up → "Time's up.".

Mechanics: every screen change cancels speech in flight
(`speechSynthesis.cancel()`), then speaks only the new screen's targeted
content. In-screen question changes (NEXT) speak through a duplicate-key
guard so re-renders, the engine's automatic same-question retry after a wrong
answer/Second Chance/time-up, timers and state changes can never re-speak
content or overlap the spoken feedback. The HUD 🔊 button and the Settings
toggle are preserved and speak (or stay silent) under the same contract.
`Router.show()` is idempotent for the already-active screen so double
navigation (the Mission entry) cannot fire the announcement twice.

Real-browser hardening (speech drop-race fix): browsers are documented to
silently drop an utterance spoken synchronously right after
`speechSynthesis.cancel()` — which is precisely the game's cancel-first
policy and made the normal-quiz question inaudible on affected engines even
though every test double recorded it. Every `speak()` is therefore
generation-stamped (stop()/newer speech invalidates stale work so an old
question can never follow a new one), preceded by `resume()` where available
(paused Android queues), and guarded by a one-shot watchdog that re-speaks
only when the utterance provably never started and the queue is idle
(`tests/jsdom_racy_synth.mjs` boots the real game against a synth double
reproducing the drop race). A 10 s resume ping keeps long story passages
from stalling. All of it engages only with a native speech implementation;
the synchronous test doubles keep deterministic behavior.

## 12. Audio assets

The original MP3s were among the unreadable archive entries. The seven
documented assets were synthesized as real MP3 files
(`tools/gen_audio.py`); the audio manager plays exactly one music track at a
time and degrades silently when playback is blocked (autoplay policies) or a
file is missing.

## 13. Save schema

`schemaVersion: 2`, export shape `{ app, schemaVersion, exportedAt, keys }` as
documented. Imports are validated (schema + keys map); unknown questioner or
pass keys are dropped and numeric fields are clamped, so tampered/corrupt
saves can never crash the game or inject progression.
