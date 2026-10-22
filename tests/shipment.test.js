/**
 * Shipment / package sync unit tests.
 * Run: node tests/shipment.test.js
 */

import assert from 'assert';
import {
  syncPackagesFromPartList,
  toLabelFields,
  parsePreviewId,
  emptyShipment,
  emptyPackage,
  innerLabelCount,
  innerLabelQuantity,
  listLabelTargets,
  previewIdForPackage,
} from '../js/shipment.js';

let passed = 0;
let failed = 0;

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

console.log('shipment tests\n');

test('syncPackagesFromPartList creates one package per part', () => {
  const pkgs = syncPackagesFromPartList(
    [
      { partNumber: '541-500002', quantity: '2000' },
      { partNumber: '541-500003', quantity: '1000' },
    ],
    [],
    { mpnDefault: 'ABC', manufacturer: 'MICRON', origin: 'JP', dateMode: '9D' }
  );
  assert.strictEqual(pkgs.length, 2);
  assert.strictEqual(pkgs[0].partNumber, '541-500002');
  assert.strictEqual(pkgs[1].quantity, '1000');
  assert.strictEqual(pkgs[0].manufacturer, 'MICRON');
});

test('syncPackagesFromPartList preserves lot/serial when PN matches', () => {
  const existing = [
    {
      id: 'a',
      partNumber: '541-500002',
      quantity: '1',
      mpn: 'X',
      manufacturer: 'M',
      origin: 'JP',
      lot: 'LOT1',
      dateCode: '20210123',
      expiry: '',
      serial: 'SER1',
      msl: '3',
    },
  ];
  const pkgs = syncPackagesFromPartList(
    [
      { partNumber: '541-500002', quantity: '2000' },
      { partNumber: 'NEW', quantity: '5' },
    ],
    existing,
    { mpnDefault: '', manufacturer: '', origin: '', dateMode: '9D' }
  );
  assert.strictEqual(pkgs[0].lot, 'LOT1');
  assert.strictEqual(pkgs[0].serial, 'SER1');
  assert.strictEqual(pkgs[0].quantity, '2000');
  assert.strictEqual(pkgs[1].partNumber, 'NEW');
  assert.strictEqual(pkgs[1].lot, '');
});

test('toLabelFields builds outer vs inner', () => {
  const ship = emptyShipment();
  ship.po = 'PO1';
  ship.packingSlip = 'PS1';
  ship.material = 'hardware';
  const pkg = {
    id: '1',
    partNumber: '541-500002',
    quantity: '10',
    mpn: 'ABC',
    manufacturer: 'MICRON',
    origin: 'JP',
    lot: 'L1',
    dateCode: '20210123',
    expiry: '',
    serial: '1ABC',
    msl: '3',
  };
  const outer = toLabelFields(ship, pkg, 'outer');
  const inner = toLabelFields(ship, pkg, 'inner');
  assert.strictEqual(outer.packaging, 'outer');
  assert.strictEqual(inner.packaging, 'inner');
  assert.strictEqual(outer.partNumber, '541-500002');
  assert.strictEqual(outer.po, 'PO1');
});

test('parsePreviewId', () => {
  assert.deepStrictEqual(parsePreviewId('slip'), { kind: 'slip' });
  assert.deepStrictEqual(parsePreviewId('label-0-inner'), {
    kind: 'label',
    index: 0,
    packaging: 'inner',
    unitIndex: 0,
  });
  assert.deepStrictEqual(parsePreviewId('label-1-inner-3'), {
    kind: 'label',
    index: 1,
    packaging: 'inner',
    unitIndex: 3,
  });
});

test('innerMode each expands to N inners at qty 1', () => {
  const pkg = emptyPackage({ quantity: '10', innerMode: 'each', partNumber: '830-96265' });
  assert.strictEqual(innerLabelCount(pkg), 10);
  assert.strictEqual(innerLabelQuantity(pkg), '1');
  const ship = emptyShipment();
  ship.packages = [pkg];
  const targets = listLabelTargets(ship);
  assert.strictEqual(targets.length, 11); // 1 outer + 10 inner
  assert.strictEqual(targets[0].id, previewIdForPackage(0, 'outer'));
  assert.strictEqual(targets[1].id, previewIdForPackage(0, 'inner', 0));
  assert.strictEqual(targets[10].id, previewIdForPackage(0, 'inner', 9));
  const innerFields = toLabelFields(ship, pkg, 'inner', 0);
  const outerFields = toLabelFields(ship, pkg, 'outer');
  assert.strictEqual(outerFields.quantity, '10');
  assert.strictEqual(innerFields.quantity, '1');
});

test('innerMode same keeps one inner with outer qty', () => {
  const pkg = emptyPackage({ quantity: '10', innerMode: 'same', partNumber: '830-96265' });
  assert.strictEqual(innerLabelCount(pkg), 1);
  assert.strictEqual(innerLabelQuantity(pkg), '10');
  const ship = emptyShipment();
  ship.packages = [pkg];
  assert.strictEqual(listLabelTargets(ship).length, 2);
});

test('syncPackagesFromPartList preserves innerMode', () => {
  const existing = [
    emptyPackage({
      id: 'a',
      partNumber: '830-96265',
      quantity: '1',
      innerMode: 'each',
      lot: 'LOT1',
    }),
  ];
  const pkgs = syncPackagesFromPartList(
    [{ partNumber: '830-96265', quantity: '10' }],
    existing,
    { mpnDefault: '', manufacturer: '', origin: '', dateMode: '9D' }
  );
  assert.strictEqual(pkgs[0].innerMode, 'each');
  assert.strictEqual(pkgs[0].lot, 'LOT1');
  assert.strictEqual(pkgs[0].quantity, '10');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
