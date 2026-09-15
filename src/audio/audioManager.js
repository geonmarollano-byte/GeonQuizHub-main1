/**
 * GEON'S GAMEHUB - audioManager.js
 * Single audio coordinator (blueprint: prevent multiple music tracks playing
 * simultaneously / conflicting audio). Exactly one music track can play at a
 * time; SFX are short one-shots. All playback is defensive: missing files or
 * autoplay restrictions degrade silently instead of breaking the game.
 */
const MUSIC_TRACKS = {
  home: 'home-music.mp3',
  game: 'game-music.mp3',
  motto: 'motto-music.mp3',
  victory: 'victory.mp3',
};

const SFX = {
  click: 'click.mp3',
  correct: 'correct.mp3',
  wrong: 'wrong.mp3',
};

export class AudioManager {
  /**
   * @param {object} opts
   *   settings: SettingsState-like { get('music'), get('sound') } or plain object
   *   AudioImpl: optional Audio constructor (tests)
   */
  constructor({ settings, AudioImpl } = {}) {
    this.settings = settings || null;
    this.AudioImpl = AudioImpl || (typeof Audio !== 'undefined' ? Audio : null);
    this.currentMusicName = null;
    this._music = null;
    this._sfxCache = new Map();
  }

  _musicEnabled() {
    if (!this.settings) return true;
    return typeof this.settings.get === 'function' ? this.settings.get('music') : this.settings.music;
  }

  _soundEnabled() {
    if (!this.settings) return true;
    return typeof this.settings.get === 'function' ? this.settings.get('sound') : this.settings.sound;
  }

  /** Play one of: home | game | motto | victory. Stops any other track first. */
  playMusic(name) {
    if (!MUSIC_TRACKS[name]) return;
    if (this.currentMusicName === name && this._music && !this._music.paused) return;
    this.stopMusic();
    if (!this._musicEnabled() || !this.AudioImpl) return;
    try {
      const audio = new this.AudioImpl(MUSIC_TRACKS[name]);
      audio.loop = true;
      audio.volume = 0.35;
      audio.addEventListener('error', () => {
        if (this._music === audio) this._music = null;
      });
      this._music = audio;
      this.currentMusicName = name;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      this._music = null;
      this.currentMusicName = null;
    }
  }

  stopMusic() {
    if (this._music) {
      try {
        this._music.pause();
        this._music.currentTime = 0;
      } catch {
        /* ignore */
      }
      this._music = null;
    }
    this.currentMusicName = null;
  }

  /** One-shot sound effect: click | correct | wrong. */
  playSfx(name) {
    if (!SFX[name] || !this._soundEnabled() || !this.AudioImpl) return;
    try {
      let audio = this._sfxCache.get(name);
      if (!audio) {
        audio = new this.AudioImpl(SFX[name]);
        audio.volume = 0.6;
        audio.addEventListener('error', () => this._sfxCache.delete(name));
        this._sfxCache.set(name, audio);
      }
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** Re-evaluate after a settings change (music/sound toggles). */
  refresh() {
    if (!this._musicEnabled()) {
      this.stopMusic();
    } else if (this.currentMusicName) {
      const name = this.currentMusicName;
      this.stopMusic();
      this.playMusic(name);
    }
  }
}
