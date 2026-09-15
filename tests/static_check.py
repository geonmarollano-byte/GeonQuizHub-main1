#!/usr/bin/env python3
"""
GEON'S GAMEHUB - tests/static_check.py
Static checks (documented in the blueprint testing section):
  1. Every file from the project inventory exists.
  2. Every .js file passes `node --check`.
  3. JSON banks parse and match the documented distributions exactly.
  4. index.html contains every documented screen and has no duplicate ids.
  5. Service worker precache list only references files that exist.
  6. Embedded question banks are valid JS that assigns window globals.
Exit code 0 = all checks passed.
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILURES = []

INVENTORY = [
    "index.html", "style.css", "script.js",
    "questions.json", "questions.new.json",
    "questions.embedded.js", "questions.new.embedded.js",
    "service-worker.js", "manifest.webmanifest", "package.json",
    "src/gameCore.js",
    "src/state/storage.js", "src/state/gameState.js", "src/state/settingsState.js",
    "src/audio/audioManager.js",
    "src/data/dailyChallenge.js", "src/data/questionLoader.js",
    "src/data/questionValidator.js", "src/data/subjectCatalog.js",
    "src/mission/mission.js", "src/mission/missionData.js",
    "src/story/storyData.js", "src/story/storyQuiz.js",
    "src/accessibility/reader.js",
    "src/quiz/quizEngine.js", "src/quiz/quizModes.js", "src/quiz/scoring.js",
    "src/quiz/sessionBuilder.js", "src/quiz/timer.js",
    "src/economy/inventory.js", "src/economy/rewards.js", "src/economy/shop.js",
    "src/progression/achievements.js", "src/progression/streaks.js",
    "src/progression/subjectStats.js", "src/progression/titles.js",
    "src/ui/notifications.js", "src/ui/overlays.js", "src/ui/render.js", "src/ui/router.js",
    "tests/core.test.js", "tests/mission.test.js", "tests/questioner.test.js",
    "tests/regression.test.js", "tests/storage.test.js", "tests/story_quiz.test.js",
    "tests/browser_smoke.py", "tests/static_check.py",
    "click.mp3", "correct.mp3", "wrong.mp3",
    "game-music.mp3", "home-music.mp3", "motto-music.mp3", "victory.mp3",
    "favicon.svg", "icons/icon-192.svg", "icons/icon-512.svg",
]

SCREENS = [
    "screen-intro", "screen-motto", "screen-home", "screen-subjects",
    "screen-levels", "screen-quiz", "screen-story-select", "screen-story-reader",
    "screen-story-questions", "screen-story-results", "screen-mission",
    "screen-mission-results", "screen-profile", "screen-convert",
    "screen-reviewer", "screen-reviewer-quiz", "screen-reviewer-results",
    "screen-daily", "screen-daily-results", "screen-shop", "screen-inventory",
    "screen-menu", "screen-settings", "screen-info", "screen-leaderboards",
    "screen-titles", "screen-achievements", "screen-gameover", "screen-victory",
    "screen-coming-soon", "screen-code",
]

DISTRIBUTION = {
    "MATH": {"Multiplication": 15, "Division": 15, "Addition": 15, "Subtraction": 15, "Problem Solving": 20},
    "SCIENCE": {"Solid, Liquid, Gas": 15, "Translational / Rotational Motions": 15,
                "Pascal's Principles": 20, "Archimedes' Principles": 15, "History": 15},
    "PSYCHOLOGY": {"Mind Manipulations": 20, "Self Resilience": 20, "Convince Others": 20,
                   "How to Become Unstoppable": 20},
    "TECH 1": {"System Unit and Its Components": 30, "OHS Guidelines and DMA Procedures": 20,
               "Assemble and Disassemble System Unit": 30},
    "TECH 2": {"BIOS / CMOS / UEFI": 30, "Networking": 20, "Windows Installation": 20,
               "Safety Procedures": 10},
}
QUIZ_TYPES = ["SUBJECT 1", "SUBJECT 2"]


def check(cond, message):
    if not cond:
        FAILURES.append(message)


def check_inventory():
    for rel in INVENTORY:
        check(os.path.isfile(os.path.join(ROOT, rel)), f"missing file: {rel}")


def check_js_syntax():
    js_files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "tests")]
        for f in filenames:
            if f.endswith(".js"):
                js_files.append(os.path.join(dirpath, f))
    for js in sorted(js_files):
        rel = os.path.relpath(js, ROOT)
        proc = subprocess.run(["node", "--check", js], capture_output=True, text=True)
        check(proc.returncode == 0, f"node --check failed: {rel}\n{proc.stderr[:300]}")
    print(f"  js syntax: {len(js_files)} files OK" if not FAILURES else "  js syntax: failures above")


def check_banks():
    for filename, questioner in [("questions.json", "previous"), ("questions.new.json", "new")]:
        with open(os.path.join(ROOT, filename), encoding="utf-8") as f:
            doc = json.load(f)
        check(doc.get("questioner") == questioner, f"{filename}: wrong questioner marker")
        questions = doc.get("questions", [])
        check(len(questions) == 800, f"{filename}: expected 800 questions, found {len(questions)}")
        ids = [q.get("id") for q in questions]
        check(len(ids) == len(set(ids)), f"{filename}: duplicate question ids")
        texts = [q.get("question") for q in questions]
        check(len(texts) == len(set(texts)), f"{filename}: duplicate question texts")
        counts = Counter((q["subject"], q["quizType"], q["topic"]) for q in questions)
        for subject, topics in DISTRIBUTION.items():
            for quiz in QUIZ_TYPES:
                for topic, n in topics.items():
                    got = counts.get((subject, quiz, topic), 0)
                    check(got == n, f"{filename}: {subject}/{quiz}/{topic} expected {n}, found {got}")
                # level coverage
                levels = sorted(q["level"] for q in questions
                                if q["subject"] == subject and q["quizType"] == quiz)
                check(levels == list(range(1, 81)), f"{filename}: {subject}/{quiz} levels must be 1..80")
        # answer integrity
        for q in questions:
            check(len(q.get("choices", [])) == 4, f"{filename}:{q.get('id')}: needs 4 choices")
            check(len(set(q.get("choices", []))) == 4, f"{filename}:{q.get('id')}: duplicate choices")
            check(q.get("answer") in q.get("choices", []), f"{filename}:{q.get('id')}: answer not in choices")
        print(f"  {filename}: 800 records, distributions exact" if not FAILURES else f"  {filename}: failures above")


def check_html():
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for screen in SCREENS:
        check(f'id="{screen}"' in html, f"index.html missing screen: {screen}")
    ids = re.findall(r'id="([^"]+)"', html)
    dupes = {i for i in ids if ids.count(i) > 1}
    check(not dupes, f"index.html duplicate ids: {sorted(dupes)}")
    for asset in ("style.css", "script.js", "questions.embedded.js", "questions.new.embedded.js",
                  "manifest.webmanifest", "favicon.svg"):
        check(asset in html, f"index.html does not reference {asset}")
    check('data-theme' in html, "index.html missing theme attribute hook")


def check_service_worker():
    with open(os.path.join(ROOT, "service-worker.js"), encoding="utf-8") as f:
        sw = f.read()
    entries = re.findall(r"'([^']+\.(?:html|css|js|json|mp3|svg|webmanifest))'", sw)
    missing = [e for e in entries if not os.path.isfile(os.path.join(ROOT, e.lstrip("./")))]
    check(not missing, f"service worker precaches missing files: {missing}")
    check(len(entries) >= 45, f"service worker precache suspiciously small: {len(entries)}")


def check_embedded():
    for filename, global_name in [("questions.embedded.js", "GEON_QUESTIONS_PREVIOUS"),
                                  ("questions.new.embedded.js", "GEON_QUESTIONS_NEW")]:
        with open(os.path.join(ROOT, filename), encoding="utf-8") as f:
            head = f.read(200)
        check(f"window.{global_name}" in head, f"{filename}: must assign window.{global_name}")


def main():
    print("GEON'S GAMEHUB static checks")
    check_inventory()
    check_js_syntax()
    check_banks()
    check_html()
    check_service_worker()
    check_embedded()
    if FAILURES:
        print(f"\nFAILED - {len(FAILURES)} problem(s):")
        for f in FAILURES[:40]:
            print(f"  - {f}")
        sys.exit(1)
    print("\nALL STATIC CHECKS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
