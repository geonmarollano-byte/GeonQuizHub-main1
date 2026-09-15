/**
 * GEON'S GAMEHUB - tests/storage.test.js
 * GeonStorage: get/set/remove/has/exportAll/importAll/validateImport/backup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeonStorage, memoryBackend } from '../src/state/storage.js';
import { GAME } from '../src/gameCore.js';

function fresh() {
  return new GeonStorage({ backend: memoryBackend() });
}

test('set/get round-trips JSON values', () => {
  const s = fresh();
  s.set('profile', { name: 'Geo', code: 'G-42' });
  assert.deepEqual(s.get('profile'), { name: 'Geo', code: 'G-42' });
  assert.equal(s.get('missing', 'fallback'), 'fallback');
});

test('corrupt entries degrade to defaults instead of throwing', () => {
  const s = fresh();
  s.backend.setItem(`${GAME.STORAGE_PREFIX}:broken`, '{not valid json');
  assert.equal(s.get('broken', 'safe'), 'safe');
});

test('has/remove/keys work and are namespaced', () => {
  const s = fresh();
  s.set('economy', { coins: 5 });
  assert.equal(s.has('economy'), true);
  s.backend.setItem('other-app:secret', '1');
  assert.deepEqual(s.keys(), ['economy']);
  s.remove('economy');
  assert.equal(s.has('economy'), false);
});

test('exportAll produces the documented save structure', () => {
  const s = fresh();
  s.set('profile', { name: 'Geo' });
  s.set('economy', { coins: 10, points: 20 });
  const save = s.exportAll();
  assert.equal(save.app, 'geons-gamehub');
  assert.equal(save.schemaVersion, GAME.SCHEMA_VERSION);
  assert.equal(typeof save.exportedAt, 'string');
  assert.ok(save.keys && typeof save.keys === 'object');
  assert.deepEqual(save.keys.profile, { name: 'Geo' });
});

test('validateImport rejects malformed payloads', () => {
  const s = fresh();
  assert.equal(s.validateImport(null).ok, false);
  assert.equal(s.validateImport('nope').ok, false);
  assert.equal(s.validateImport({ keys: {} }).ok, false); // no schemaVersion
  assert.equal(s.validateImport({ schemaVersion: 999, keys: {} }).ok, false); // newer schema
  assert.equal(s.validateImport({ schemaVersion: GAME.SCHEMA_VERSION }).ok, false); // no keys
  assert.equal(s.validateImport({ schemaVersion: GAME.SCHEMA_VERSION, keys: {} }).ok, true);
});

test('importAll applies a valid export and rejects invalid ones', () => {
  const src = fresh();
  src.set('profile', { name: 'A' });
  src.set('economy', { coins: 7 });
  const save = src.exportAll();

  const dst = fresh();
  dst.set('profile', { name: 'B' });
  const result = dst.importAll(save);
  assert.equal(result.ok, true);
  assert.equal(result.applied, 2);
  assert.deepEqual(dst.get('profile'), { name: 'A' });

  const rejected = dst.importAll({ bogus: true });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.applied, 0);
});

test('backup stores a timestamped snapshot that can be restored', () => {
  const s = fresh();
  s.set('economy', { coins: 3 });
  const backupKey = s.backup();
  assert.ok(backupKey.startsWith('backup:'));
  const snapshot = s.get(backupKey);
  assert.equal(snapshot.keys.economy.coins, 3);
  // mutate then restore from backup
  s.set('economy', { coins: 999 });
  s.importAll(snapshot);
  assert.equal(s.get('economy').coins, 3);
});
