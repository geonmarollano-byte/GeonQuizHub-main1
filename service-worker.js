/**
 * GEON'S GAMEHUB - service-worker.js
 * PWA/offline support: precaches the full app shell (including both question
 * banks, embedded fallbacks, audio and icons) so the game works offline.
 * Strategy: cache-first for same-origin GETs with network fallback, and
 * runtime caching for anything not precached.
 */
const CACHE_VERSION = 'geonshub-v1.0.2';

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.svg',
  'icons/icon-512.svg',
  'questions.json',
  'questions.new.json',
  'questions.embedded.js',
  'questions.new.embedded.js',
  'click.mp3',
  'correct.mp3',
  'wrong.mp3',
  'game-music.mp3',
  'home-music.mp3',
  'motto-music.mp3',
  'victory.mp3',
  // src modules
  'src/gameCore.js',
  'src/state/storage.js',
  'src/state/gameState.js',
  'src/state/settingsState.js',
  'src/audio/audioManager.js',
  'src/data/dailyChallenge.js',
  'src/data/questionLoader.js',
  'src/data/questionValidator.js',
  'src/data/subjectCatalog.js',
  'src/mission/mission.js',
  'src/mission/missionData.js',
  'src/story/storyData.js',
  'src/story/storyQuiz.js',
  'src/accessibility/reader.js',
  'src/quiz/quizEngine.js',
  'src/quiz/quizModes.js',
  'src/quiz/scoring.js',
  'src/quiz/sessionBuilder.js',
  'src/quiz/timer.js',
  'src/economy/inventory.js',
  'src/economy/rewards.js',
  'src/economy/shop.js',
  'src/progression/achievements.js',
  'src/progression/streaks.js',
  'src/progression/subjectStats.js',
  'src/progression/titles.js',
  'src/ui/notifications.js',
  'src/ui/overlays.js',
  'src/ui/render.js',
  'src/ui/router.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html'));
    })
  );
});
