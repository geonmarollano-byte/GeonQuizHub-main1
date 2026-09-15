# GEON'S GAMEHUB

A browser-based educational quiz/game platform. Five subjects, two quiz types
per subject, 80 levels per path, two questioners (Previous / New), plus
Reviewer Mode, Daily Challenge, Story Quiz and Missions — with coins, points,
shop items, achievements, titles, themes, AI-reader accessibility, save
import/export and full PWA/offline support.

> **Provenance.** This release is a faithful rebuild from the authoritative
> blueprint (`GEON_GAMEHUB_MAIN1_FULL_DEVELOPER_AUDIT.md`, `GAME_FLOW_MAPS.md`,
> `FILE_INVENTORY.csv`, `ZIP_REPAIR_AND_RELEASE_NOTES.md`). The original
> `geonsgamehubmain.zip` was structurally corrupted, so the two question banks
> were regenerated to match the documented distributions **exactly**
> (verified by tests and static checks). See `DESIGN_DECISIONS.md` for every
> detail the blueprint left open.

## Quick start

Serve the folder with any static web server and open it:

```bash
python3 -m http.server 8000
# -> http://localhost:8000
```

(The game also runs from `file://` using the embedded question banks, but a
server is recommended for the full PWA/offline experience.)

## Game systems (as documented)

| System | Summary |
| --- | --- |
| Normal Quiz | Home → Subject → Quiz Type → Level → Quiz. 8 lives, 30 s per question, 80 levels per path, Level 80 = Victory. Game Over resets the path to Level 1. |
| Reward bands | L1–20: 50 score/5 🪙/10 🎯 · L21–40: 100/10/20 · L41–60: 175/15/35 · L61–80: 300/25/60 |
| Streaks | ×1 → ×1.2 (3–4) → ×1.5 (5–9) → ×2 (10–14) → ×2.5 (15–19) → ×3 (20+); milestones HOT START/ON FIRE/UNSTOPPABLE/QUIZ MASTER/LEGENDARY STREAK |
| Shop items | Life Token 100 🪙 (cap 8 lives) · Time Boost 75 (+10 s) · Hint 100 · 50/50 150 · Second Chance 200 (retry, no life lost, no double counting) |
| Reviewer | Subject → Questioner → Topic filter → practice round with explanations (no lives/timer/progress) |
| Daily Challenge | 10 deterministic questions per date+questioner, 8 lives, 30 s; +100 🎯/+5 🪙 once per day (`rewardClaimed` guard) |
| Story Quiz | 10 stories × 5 comprehension questions (detail/setting/sequence/inference/reasonable inference); +75 🎯/+15 🪙 per story, +50/+10 perfect, +200/+50 all-stories (guarded) |
| Missions | 5 missions (one per subject family); +100 🎯/+20 🪙 each, +250/+75 all five (guarded) |
| Economy | Coins + points, points → coins conversion (10 pts = 5 🪙 per block) |
| Progression | Per questioner, per subject, per quiz type: completed levels, highest level, best score; titles by total levels; achievements (documented list) |
| Questioners | PREVIOUS and NEW banks with **fully separated** progress/statistics |
| Settings | Music, Sound, AI Reader, Questioner, Theme (Original/Light/Dark) |
| Saves | Auto-save to localStorage; Export / Import (validated) / Backup / Reset |
| PWA | `manifest.webmanifest` + `service-worker.js` precache → installable & offline |

## Project layout

```
index.html / style.css / script.js     UI shell, themes, main controller
questions.json / questions.new.json    Previous / New banks (800 records each)
questions*.embedded.js                 Offline/file:// fallback copies of the banks
src/gameCore.js                        Rules, constants, sanitization
src/quiz/*                             Engine, modes, scoring, sessions, timer
src/state/*                            GameState, SettingsState, GeonStorage
src/economy/*                          Rewards, shop, inventory
src/progression/*                      Achievements, streaks, stats, titles
src/mission/*  src/story/*             Mission & Story engines + content
src/data/*                             Catalog, loader, validator, daily seed
src/audio/*  src/accessibility/*       Audio manager, AI reader
src/ui/*                               Router, render, notifications, overlays
service-worker.js / manifest.webmanifest / icons/   PWA
*.mp3                                  Music & SFX assets
tests/                                 Unit + regression + static + smoke tests
tools/                                 Content & audio generators (dev)
```

Architecture note: per the blueprint's refactor plan, game logic lives in the
`src/` modules (single GameState, pure quiz engine, guarded reward functions);
`script.js` is only the composition root that wires DOM events to modules.

## Testing

```bash
npm test                      # 56 unit/regression tests (node --test)
python3 tests/static_check.py # inventory, syntax, bank distributions, HTML, SW
python3 tests/browser_smoke.py# HTTP asset checks + headless module smoke
                              #   + jsdom DOM smoke (npm install jsdom)
                              #   + Playwright screenshots (optional)
node tests/jsdom_smoke.mjs    # real script.js boot + full click-through
```

The jsdom smoke boots the real `index.html` + `script.js` and verifies:
intro → motto → home → subject → levels → quiz (correct/wrong/items),
shop purchase, theme + questioner switching, a full Daily run with guarded
reward and deterministic question IDs, story/reviewer/mission flows,
points conversion, profile/code panel, and the Game Over → reset → retry path.

## Content

Each questioner bank: 5 subjects × 2 quiz types × 80 levels = 800 questions,
distributed exactly as documented (e.g. MATH: Multiplication 15, Division 15,
Addition 15, Subtraction 15, Problem Solving 20 — per path). Regenerate with:

```bash
python3 tools/generate_content.py   # banks + embedded copies
python3 tools/gen_audio.py          # mp3 assets (requires: pip install lameenc)
```
