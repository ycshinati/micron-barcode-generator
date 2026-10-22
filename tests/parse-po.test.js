/**
 * PO text parser tests against English / Korean Micron Ariba fixtures.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyParsedPoToShipment,
  detectPoLanguage,
  extractPoNumber,
  parsePoText,
} from '../js/parse-po.js';
import { emptyShipment } from '../js/shipment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'po');

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  OK ', name);
    passed++;
  } catch (err) {
    console.error('  FAIL', name, err && err.message ? err.message : err);
    failed++;
  }
}

console.log('\nparse-po tests\n');

test('extractPoNumber English', () => {
  const t = readFixture('4517190278.txt');
  assert.strictEqual(extractPoNumber(t), '4517190278');
  assert.strictEqual(detectPoLanguage(t), 'en');
});

test('extractPoNumber English MTB', () => {
  const t = readFixture('3501631116.txt');
  assert.strictEqual(extractPoNumber(t), '3501631116');
});

test('extractPoNumber Korean', () => {
  const t = readFixture('PO4516739305_Tongluo.txt');
  assert.strictEqual(extractPoNumber(t), '4516739305');
  assert.strictEqual(detectPoLanguage(t), 'ko');
});

test('parsePoText MSB sensor — (P)=Customer Part #, (1P)=Part #', () => {
  const parsed = parsePoText(readFixture('4517190278.txt'));
  assert.strictEqual(parsed.po, '4517190278');
  assert.strictEqual(parsed.lines.length, 1);
  assert.strictEqual(parsed.lines[0].partNumber, '840-18724');
  assert.strictEqual(parsed.lines[0].mpn, 'CP00000465');
  assert.strictEqual(parsed.lines[0].quantity, '3');
});

test('parsePoText MSB vacuum pad — (P)=830-96265, (1P)=B00003058', () => {
  const parsed = parsePoText(readFixture('4516692328.txt'));
  assert.strictEqual(parsed.po, '4516692328');
  assert.strictEqual(parsed.lines.length, 1);
  assert.strictEqual(parsed.lines[0].partNumber, '830-96265');
  assert.strictEqual(parsed.lines[0].mpn, 'B00003058');
  assert.strictEqual(parsed.lines[0].quantity, '1');
});

test('parsePoText MTB spare parts — no Customer Part #; (1P)=Part #, (P) falls back', () => {
  const parsed = parsePoText(readFixture('3501631116.txt'));
  assert.strictEqual(parsed.po, '3501631116');
  assert.strictEqual(parsed.lines.length, 3);
  assert.deepStrictEqual(
    parsed.lines.map(function (l) {
      return [l.partNumber, l.quantity, l.mpn];
    }),
    [
      ['', '1', 'P0000460'],
      ['', '1', 'P0011371'],
      ['', '1', 'P0023267'],
    ]
  );
  const { shipment } = applyParsedPoToShipment(parsed, emptyShipment());
  assert.deepStrictEqual(
    shipment.partLines.map(function (l) {
      return l.partNumber;
    }),
    ['P0000460', 'P0011371', 'P0023267']
  );
  assert.deepStrictEqual(
    shipment.packages.map(function (p) {
      return p.mpn;
    }),
    ['P0000460', 'P0011371', 'P0023267']
  );
});

test('parsePoText Korean Tongluo — digit token → (1P), (P) blank then fallback', () => {
  const parsed = parsePoText(readFixture('PO4516739305_Tongluo.txt'));
  assert.strictEqual(parsed.po, '4516739305');
  assert.ok(parsed.lines.length >= 1, 'expected at least one line');
  assert.strictEqual(parsed.lines[0].quantity, '1');
  assert.strictEqual(parsed.lines[0].partNumber, '');
  assert.strictEqual(parsed.lines[0].mpn, '000000060000054856');
});

test('applyParsedPoToShipment maps (P)=XXX-XXXXX and (1P)=BXXXXXXX', () => {
  const parsed = parsePoText(readFixture('4516692328.txt'));
  const { shipment } = applyParsedPoToShipment(parsed, emptyShipment());
  assert.strictEqual(shipment.po, '4516692328');
  assert.strictEqual(shipment.partLines[0].partNumber, '830-96265');
  assert.strictEqual(shipment.mpnDefault, 'B00003058');
  assert.strictEqual(shipment.packages[0].partNumber, '830-96265');
  assert.strictEqual(shipment.packages[0].mpn, 'B00003058');
  assert.strictEqual(shipment.manufacturer, 'ATI');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
