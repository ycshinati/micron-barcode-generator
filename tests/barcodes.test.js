/**
 * Geometry defaults for 1D Code 128 (no DOM / bwip required).
 */
import assert from 'assert';
import { CODE128_OPTS } from '../js/barcodes.js';

function test(name, fn) {
  try {
    fn();
    console.log('  OK ', name);
  } catch (err) {
    console.error('  FAIL', name, err.message);
    process.exitCode = 1;
  }
}

console.log('\nbarcode geometry tests\n');

test('CODE128_OPTS uses narrower scaleX than scaleY', () => {
  assert.ok(CODE128_OPTS.scaleX < CODE128_OPTS.scaleY);
  assert.strictEqual(CODE128_OPTS.scaleX, 1);
  assert.ok(CODE128_OPTS.height >= 6);
});

test('CODE128_OPTS keeps bar height usable for scan', () => {
  assert.ok(CODE128_OPTS.height <= 10);
});
