/**
 * GEON'S GAMEHUB - storage.js
 * GeonStorage: the persistence abstraction documented in the blueprint.
 * Supports get/set/remove/has/exportAll/importAll/validateImport/backup.
 * Backend is injectable (localStorage in the browser, in-memory in tests).
 * All reads are JSON-safe; corrupt entries degrade to defaults, never crash.
 */
import { GAME } from '../gameCore.js';

/** In-memory backend used when localStorage is unavailable (tests, file://). */
export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export class GeonStorage {
  constructor({ backend, prefix = GAME.STORAGE_PREFIX } = {}) {
    this.prefix = prefix;
    this.backend =
      backend ||
      (typeof localStorage !== 'undefined' ? localStorage : memoryBackend());
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  _iterKeys() {
    const out = [];
    const len = this.backend.length ?? 0;
    for (let i = 0; i < len; i += 1) {
      const k = this.backend.key(i);
      if (k && k.startsWith(`${this.prefix}:`)) out.push(k.slice(this.prefix.length + 1));
    }
    return out;
  }

  /** get with JSON parsing; corrupt values fall back to defaultValue. */
  get(key, defaultValue = null) {
    try {
      const raw = this.backend.getItem(this._key(key));
      if (raw === null || raw === undefined) return defaultValue;
      const parsed = JSON.parse(raw);
      return parsed === undefined ? defaultValue : parsed;
    } catch {
      return defaultValue;
    }
  }

  set(key, value) {
    try {
      this.backend.setItem(this._key(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      this.backend.removeItem(this._key(key));
      return true;
    } catch {
      return false;
    }
  }

  has(key) {
    try {
      return this.backend.getItem(this._key(key)) !== null;
    } catch {
      return false;
    }
  }

  keys() {
    try {
      return this._iterKeys();
    } catch {
      return [];
    }
  }

  /** Exported save structure documented in the blueprint. */
  exportAll() {
    const keys = {};
    for (const key of this.keys()) {
      keys[key] = this.get(key, null);
    }
    return {
      app: 'geons-gamehub',
      schemaVersion: GAME.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      keys,
    };
  }

  /** Validate an import payload BEFORE applying it (never throws). */
  validateImport(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload is not an object'] };
    }
    if (payload.app && payload.app !== 'geons-gamehub') {
      errors.push(`unknown app marker: ${payload.app}`);
    }
    if (typeof payload.schemaVersion !== 'number') {
      errors.push('schemaVersion missing or not a number');
    } else if (payload.schemaVersion > GAME.SCHEMA_VERSION) {
      errors.push(`save is from a newer schema (${payload.schemaVersion} > ${GAME.SCHEMA_VERSION})`);
    }
    if (!payload.keys || typeof payload.keys !== 'object' || Array.isArray(payload.keys)) {
      errors.push('keys map missing');
    }
    return { ok: errors.length === 0, errors };
  }

  /**
   * Import previously-exported data. Invalid payloads are rejected wholesale;
   * individual invalid entries are skipped. Existing data for other questioners
   * is untouched because keys are imported verbatim (progress keys are already
   * questioner-scoped inside their values).
   */
  importAll(payload) {
    const check = this.validateImport(payload);
    if (!check.ok) return { ok: false, applied: 0, errors: check.errors };
    let applied = 0;
    for (const [key, value] of Object.entries(payload.keys)) {
      if (typeof key !== 'string' || !key || key.length > 128) continue;
      if (value === null || value === undefined) continue;
      if (this.set(key, value)) applied += 1;
    }
    return { ok: true, applied, errors: [] };
  }

  /** Copy current save under a timestamped backup key. Returns the key. */
  backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `backup:${stamp}`;
    const snapshot = this.exportAll();
    this.set(key, snapshot);
    return key;
  }
}
