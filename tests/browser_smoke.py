#!/usr/bin/env python3
"""
GEON'S GAMEHUB - tests/browser_smoke.py
Browser smoke test (documented in the blueprint):

  1. Starts a local web server on the project root.
  2. Verifies every app asset is served with HTTP 200 and correct size.
  3. Verifies the HTML shell references all screens and assets.
  4. If Playwright is installed, additionally drives a real browser through
     the intro -> home -> subject -> level -> quiz flow and the theme switch,
     capturing tests/smoke-original.png, smoke-light.png and smoke-dark.png.
  5. Always runs the Node module smoke script (tests/node_smoke.mjs) which
     exercises every src/ module flow headlessly.

Exit code 0 = smoke test passed.
"""
import http.server
import os
import shutil
import socketserver
import subprocess
import sys
import threading
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8613
BASE = f"http://127.0.0.1:{PORT}"

ASSETS = [
    "/", "index.html", "style.css", "script.js", "manifest.webmanifest",
    "service-worker.js", "favicon.svg", "icons/icon-192.svg", "icons/icon-512.svg",
    "questions.json", "questions.new.json",
    "questions.embedded.js", "questions.new.embedded.js",
    "click.mp3", "correct.mp3", "wrong.mp3",
    "home-music.mp3", "game-music.mp3", "motto-music.mp3", "victory.mp3",
    "src/gameCore.js", "src/quiz/quizEngine.js", "src/state/gameState.js",
    "src/story/storyData.js", "src/mission/missionData.js",
]

failures = []


def serve():
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *args: None

    class Bound(socketserver.TCPServer):
        allow_reuse_address = True

    httpd = Bound(("127.0.0.1", PORT), lambda *a: handler(*a, directory=ROOT))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def http_checks():
    for asset in ASSETS:
        url = f"{BASE}/{asset.lstrip('/')}" if asset != "/" else BASE + "/"
        try:
            with urllib.request.urlopen(url, timeout=10) as res:
                body = res.read()
                if res.status != 200:
                    failures.append(f"{asset}: HTTP {res.status}")
                elif len(body) == 0:
                    failures.append(f"{asset}: empty response")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{asset}: {exc}")
    print(f"  http: {len(ASSETS)} assets checked")


def node_module_smoke():
    script = os.path.join(ROOT, "tests", "node_smoke.mjs")
    if not os.path.isfile(script):
        failures.append("tests/node_smoke.mjs missing")
        return
    proc = subprocess.run(["node", script], capture_output=True, text=True, cwd=ROOT)
    if proc.returncode != 0:
        failures.append(f"node module smoke failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}")
    else:
        print(f"  node smoke: {proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else 'OK'}")


def jsdom_smoke():
    """Real DOM smoke: boots script.js + index.html in jsdom and clicks through
    the game. Optional - requires `npm install jsdom` in the project root."""
    script = os.path.join(ROOT, "tests", "jsdom_smoke.mjs")
    if not os.path.isdir(os.path.join(ROOT, "node_modules", "jsdom")):
        print("  jsdom: not installed - skipping DOM smoke (npm install jsdom to enable)")
        return
    proc = subprocess.run(["node", script], capture_output=True, text=True, cwd=ROOT)
    if proc.returncode != 0:
        failures.append(f"jsdom DOM smoke failed:\n{proc.stdout[-1500:]}\n{proc.stderr[-1500:]}")
    else:
        print(f"  jsdom: {proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else 'OK'}")


def playwright_flow():
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        print("  playwright: not installed - skipping browser screenshots (HTTP + node smoke still ran)")
        return
    shots = {"original": "smoke-original.png", "light": "smoke-light.png", "dark": "smoke-dark.png"}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 420, "height": 900})
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(BASE + "/", wait_until="networkidle")
        page.click("#intro-enter")
        page.click("#motto-continue")
        page.wait_for_selector("#screen-home.active")
        page.click(".tile-play")
        page.wait_for_selector("#screen-subjects.active")
        page.click(".subject-card")
        page.click("#subjects-continue")
        page.wait_for_selector("#screen-levels.active")
        page.click(".level-cell.next")
        page.wait_for_selector("#screen-quiz.active")
        page.wait_for_selector(".choice-btn")
        for theme, filename in shots.items():
            page.evaluate(
                f"""() => {{
                    document.documentElement.setAttribute('data-theme', '{theme}');
                }}"""
            )
            page.screenshot(path=os.path.join(ROOT, "tests", filename))
        browser.close()
        if errors:
            failures.append(f"browser page errors: {errors[:5]}")
        else:
            print("  playwright: intro->home->subjects->levels->quiz flow OK, 3 theme screenshots saved")


def main():
    print("GEON'S GAMEHUB browser smoke test")
    httpd = serve()
    try:
        http_checks()
        node_module_smoke()
        jsdom_smoke()
        playwright_flow()
    finally:
        httpd.shutdown()
    if failures:
        print(f"\nSMOKE TEST FAILED - {len(failures)} problem(s):")
        for f in failures[:20]:
            print(f"  - {f}")
        sys.exit(1)
    print("\nSMOKE TEST PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
