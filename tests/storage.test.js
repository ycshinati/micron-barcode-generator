/**
 * Unit tests for save/load payload helpers.
 * Run: node tests/storage.test.js
 */

import assert from 'assert';
import { SAMPLE_HARDWARE, SAMPLE_PACKING_SLIP } from '../js/encode.js';
import {
  STORAGE_KEY,
  buildSavedPayload,
  loadFromLocalStorage,
  normalizeFields,
  parseSavedJson,
  saveToLocalStorage,
  toDownloadFilename,
} from '../js/storage.js';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err && err.message ? err.message : err}`);
  }
}

/** Minimal in-memory Storage mock */
function createMemoryStorage() {
  /** @type {Record<string, string>} */
  const map = {};
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function (k, v) {
      map[k] = String(v);
    },
    removeItem: function (k) {
      delete map[k];
    },
  };
}

console.log('storage tests\n');

test('normalizeFields accepts hardware sample', () => {
  const fields = normalizeFields(SAMPLE_HARDWARE);
  assert.ok(fields);
  assert.strictEqual(fields.document, 'label');
  assert.strictEqual(fields.partNumber, '541-500002');
});

test('normalizeFields defaults unknown values safely', () => {
  const fields = normalizeFields({ partNumber: 'X', partLines: [] });
  assert.ok(fields);
  assert.strictEqual(fields.document, 'label');
  assert.strictEqual(fields.material, 'hardware');
  assert.strictEqual(fields.partLines.length, 1);
});

test('normalizeFields migrates legacy lotLines to partLines', () => {
  const fields = normalizeFields({
    document: 'packing-slip',
    lotLines: [{ lot: 'OLD-LOT', quantity: '5' }],
  });
  assert.ok(fields);
  assert.strictEqual(fields.partLines.length, 1);
  assert.strictEqual(fields.partLines[0].partNumber, 'OLD-LOT');
  assert.strictEqual(fields.partLines[0].quantity, '5');
});

test('parseSavedJson round-trips wrapped payload', () => {
  const payload = buildSavedPayload(SAMPLE_PACKING_SLIP, '2026-01-01T00:00:00.000Z');
  const parsed = parseSavedJson(JSON.stringify(payload));
  assert.strictEqual(parsed.ok, true);
  if (parsed.ok) {
    assert.strictEqual(parsed.payload.fields.document, 'packing-slip');
    assert.strictEqual(parsed.payload.fields.invoice, 'INV-100234');
    assert.strictEqual(parsed.payload.fields.partLines.length, 2);
    assert.strictEqual(parsed.payload.fields.partLines[0].partNumber, '541-500002');
  }
});

test('parseSavedJson accepts bare fields object', () => {
  const parsed = parseSavedJson(JSON.stringify(SAMPLE_HARDWARE));
  assert.strictEqual(parsed.ok, true);
  if (parsed.ok) {
    assert.strictEqual(parsed.payload.fields.serial, 'BHX123456-001');
  }
});

test('parseSavedJson rejects invalid JSON', () => {
  const parsed = parseSavedJson('{not json');
  assert.strictEqual(parsed.ok, false);
});

test('localStorage save/load via mock', () => {
  const mem = createMemoryStorage();
  const saved = saveToLocalStorage(mem, SAMPLE_HARDWARE);
  assert.strictEqual(saved.ok, true);
  assert.ok(mem.getItem(STORAGE_KEY));
  const loaded = loadFromLocalStorage(mem);
  assert.strictEqual(loaded.ok, true);
  if (loaded.ok) {
    assert.strictEqual(loaded.payload.fields.po, '4512345678');
  }
});

test('toDownloadFilename includes document hint', () => {
  const name = toDownloadFilename(SAMPLE_HARDWARE);
  assert.ok(name.indexOf('micron-hardware-outer-') === 0);
  assert.ok(name.endsWith('.json'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
