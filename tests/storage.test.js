import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserStorage } from '../src/storage.js';

test('blocked browser storage allows empty reads but cannot pretend to save a schedule', () => {
  const storage = createBrowserStorage(() => { throw new Error('Access denied'); });
  assert.equal(storage.getItem('session'), null);
  assert.equal(storage.length, 0);
  assert.equal(storage.key(0), null);
  assert.throws(() => storage.setItem('session', '{}'), /storage is unavailable or full/);
});

test('storage quota failures are surfaced while existing data remains readable', () => {
  const storage = createBrowserStorage(() => ({
    getItem: () => 'existing session',
    setItem: () => { throw new Error('Quota exceeded'); },
  }));
  assert.equal(storage.getItem('session'), 'existing session');
  assert.throws(() => storage.setItem('session', 'new session'), /free some space/);
  assert.equal(storage.getItem('session'), 'existing session');
});
