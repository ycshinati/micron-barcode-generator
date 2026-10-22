/**
 * Node unit tests for encode + validate (no browser / bwip-js).
 * Run: node tests/encode.test.js
 */

import assert from 'assert';
import {
  encode1D,
  encode2D,
  encodeInvoice1D,
  encodePartLine,
  formatQuantity,
  buildFieldEncodings,
  SAMPLE_HARDWARE,
  SAMPLE_COMPONENT,
  SAMPLE_PACKING_SLIP,
} from '../js/encode.js';
import {
  validateAll,
  validateSerial,
  validateLot,
  validateDateCode,
  validateMpn,
  validateMsl,
  validatePackingSlipExpiry,
} from '../js/validators.js';

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

console.log('encode / validate tests\n');

test('encode1D wraps DI and data with asterisks', () => {
  assert.strictEqual(encode1D('K', '4512345678'), '*K4512345678*');
  assert.strictEqual(encode1D('11K', '200123-01XYZ'), '*11K200123-01XYZ*');
  assert.strictEqual(encode1D('7Q', '3000+EA'), '*7Q3000+EA*');
});

test('formatQuantity appends +EA', () => {
  assert.strictEqual(formatQuantity('3000'), '3000+EA');
  assert.strictEqual(formatQuantity('3000+EA'), '3000+EA');
});

test('encode2D builds Hardware pipe sequence (9D mode)', () => {
  const payload = encode2D(SAMPLE_HARDWARE);
  assert.strictEqual(
    payload,
    'P541-500002|1PABC1234|1TBHX12345|7Q3000+EA|SBHX123456-001|21PMICRON|9D20210123|4LJP'
  );
});

test('encode2D Component inner appends 7E MSL', () => {
  const payload = encode2D(
    Object.assign({}, SAMPLE_COMPONENT, { packaging: 'inner', msl: '3' })
  );
  assert.ok(payload.endsWith('|7E3'));
  assert.ok(payload.startsWith('P510-500002|1PERJ2GEJ220X|'));
});

test('encode2D Hardware / Component outer does not append 7E', () => {
  const hw = encode2D(SAMPLE_HARDWARE);
  const comp = encode2D(SAMPLE_COMPONENT);
  assert.ok(!hw.includes('|7E'));
  assert.ok(!comp.includes('|7E'));
});

test('encode2D builds expiry (2D) mode segment', () => {
  const payload = encode2D(
    Object.assign({}, SAMPLE_HARDWARE, {
      dateMode: '2D',
      expiry: '01-23-2021',
    })
  );
  assert.ok(payload.includes('|2D01-23-2021|'));
  assert.ok(!payload.includes('|9D'));
});

test('buildFieldEncodings human-readable omits DI asterisks', () => {
  const enc = buildFieldEncodings(SAMPLE_HARDWARE);
  assert.strictEqual(enc.po.hr, '4512345678');
  assert.strictEqual(enc.po.payload, '*K4512345678*');
  assert.strictEqual(enc.quantity.hr, '3000+EA');
});

test('validateAll accepts Hardware outer sample', () => {
  const result = validateAll(SAMPLE_HARDWARE);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

test('validateAll requires PO on outer only', () => {
  const outer = validateAll(Object.assign({}, SAMPLE_HARDWARE, { po: '' }));
  assert.strictEqual(outer.ok, false);
  assert.ok(outer.errors.po);

  const inner = validateAll(
    Object.assign({}, SAMPLE_HARDWARE, { packaging: 'inner', po: '' })
  );
  assert.strictEqual(inner.ok, true, JSON.stringify(inner.errors));
});

test('validateAll requires MSL on Component inner', () => {
  const bad = validateAll(
    Object.assign({}, SAMPLE_COMPONENT, { packaging: 'inner', msl: '' })
  );
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.msl);

  const good = validateAll(
    Object.assign({}, SAMPLE_COMPONENT, { packaging: 'inner', msl: '3' })
  );
  assert.strictEqual(good.ok, true, JSON.stringify(good.errors));
});

test('validateAll accepts packing slip sample', () => {
  const result = validateAll(SAMPLE_PACKING_SLIP);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

test('validateAll packing slip requires part lines', () => {
  const result = validateAll(
    Object.assign({}, SAMPLE_PACKING_SLIP, { partLines: [] })
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.partLines);
});

test('validatePackingSlipExpiry MM/DD/YYYY', () => {
  assert.strictEqual(validatePackingSlipExpiry('01/23/2021', true).ok, true);
  assert.strictEqual(validatePackingSlipExpiry('01-23-2021', true).ok, false);
});

test('encodeInvoice1D and encodePartLine', () => {
  assert.strictEqual(encodeInvoice1D('INV-100234'), '*INV-100234*');
  const line = encodePartLine({ partNumber: '541-500002', quantity: '2000' });
  assert.strictEqual(line.partNumber.payload, '*P541-500002*');
  assert.strictEqual(line.quantity.payload, '*7Q2000*');
});

test('validateSerial rejects leading S and overlength', () => {
  assert.strictEqual(validateSerial('').ok, true);
  assert.strictEqual(validateSerial('S12345').ok, false);
  assert.strictEqual(validateSerial('1S12345').ok, true);
  assert.strictEqual(validateSerial('ABCDEFGHIJKLMNOPQRSTU').ok, false);
});

test('validateLot max 10 and optional blank', () => {
  assert.strictEqual(validateLot('').ok, true);
  assert.strictEqual(validateLot('BHX12345678').ok, false);
  assert.strictEqual(validateLot('BHX123456').ok, true);
});

test('validateDateCode optional blank; YYYYMMDD when present', () => {
  assert.strictEqual(validateDateCode('').ok, true);
  assert.strictEqual(validateDateCode('20210123').ok, true);
  assert.strictEqual(validateDateCode('2021-01-23').ok, false);
  assert.strictEqual(validateDateCode('20211399').ok, false);
});

test('validateAll allows blank lot / serial / dateCode on labels', () => {
  const result = validateAll(
    Object.assign({}, SAMPLE_HARDWARE, { lot: '', serial: '', dateCode: '' })
  );
  assert.strictEqual(result.ok, true);
  const badDate = validateAll(Object.assign({}, SAMPLE_HARDWARE, { dateCode: '2021-01-23' }));
  assert.strictEqual(badDate.ok, false);
  assert.ok(badDate.errors.dateCode);
});

test('validateMpn rejects spaces', () => {
  assert.strictEqual(validateMpn('ABC 123').ok, false);
  assert.strictEqual(validateMpn('ABC1234').ok, true);
});

test('validateMsl accepts allowed levels', () => {
  assert.strictEqual(validateMsl('3').ok, true);
  assert.strictEqual(validateMsl('2A').ok, true);
  assert.strictEqual(validateMsl('9').ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
