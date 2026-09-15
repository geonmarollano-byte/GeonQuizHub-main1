/**
 * GEON'S GAMEHUB - settingsState.js
 * Settings boundary: music, sound, AI reader, questioner, theme.
 * Always sanitizes on load and on write so settings can never corrupt the game.
 */
import { sanitizeSettings, GAME } from '../gameCore.js';

export const SETTINGS_KEY = 'settings';

export class SettingsState {
  constructor(storage) {
    this.storage = storage;
    this.settings = sanitizeSettings(storage ? storage.get(SETTINGS_KEY, null) : null);
  }

  get all() {
    return { ...this.settings };
  }

  get(key) {
    return this.settings[key];
  }

  /** Update a subset of settings; invalid values are ignored. */
  update(patch = {}) {
    const merged = { ...this.settings };
    if (typeof patch.music === 'boolean') merged.music = patch.music;
    if (typeof patch.sound === 'boolean') merged.sound = patch.sound;
    if (typeof patch.reader === 'boolean') merged.reader = patch.reader;
    if (GAME.QUESTIONERS.includes(patch.questioner)) merged.questioner = patch.questioner;
    if (['original', 'light', 'dark'].includes(patch.theme)) merged.theme = patch.theme;
    this.settings = sanitizeSettings(merged);
    this._persist();
    return this.all;
  }

  _persist() {
    if (this.storage) this.storage.set(SETTINGS_KEY, this.settings);
  }
}
