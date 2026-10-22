/**
 * Micron 1D / 2D barcode payload builders (BEPRO §1.1.5 / §1.2 / §2.3).
 */

import { trim } from './validators.js';

/**
 * Build 1D Code 128 payload: *{DI}{data}*
 * @param {string} di
 * @param {string} data
 * @returns {string}
 */
export function encode1D(di, data) {
  const d = trim(data);
  const identifier = String(di || '');
  return `*${identifier}${d}*`;
}

/**
 * [Assumption] Invoice has no DI in §2.3.2 — encode value with asterisks only.
 * @param {string} invoice
 * @returns {string}
 */
export function encodeInvoice1D(invoice) {
  return `*${trim(invoice)}*`;
}

/**
 * Normalize quantity for labels: digits + "+EA"
 * @param {string} quantity
 * @returns {string}
 */
export function formatQuantity(quantity) {
  const v = trim(quantity).replace(/\+EA$/i, '');
  return `${v}+EA`;
}

/**
 * Digits only (packing slip total / lot qty HR may omit +EA; barcodes still use 7Q+EA for labels)
 * @param {string} quantity
 * @returns {string}
 */
export function quantityDigits(quantity) {
  return trim(quantity).replace(/\+EA$/i, '');
}

/**
 * Build Data Matrix scan string for Hardware / Component labels.
 * Component inner appends |7E{msl} per Table 11.
 * @param {import('./validators.js').LabelFields} input
 * @returns {string}
 */
export function encode2D(input) {
  const qty = formatQuantity(input.quantity);
  const dateSegment =
    input.dateMode === '2D'
      ? `2D${trim(input.expiry)}`
      : `9D${trim(input.dateCode)}`;

  const parts = [
    `P${trim(input.partNumber)}`,
    `1P${trim(input.mpn)}`,
    `1T${trim(input.lot)}`,
    `7Q${qty}`,
    `S${trim(input.serial)}`,
    `21P${trim(input.manufacturer)}`,
    dateSegment,
    `4L${trim(input.origin)}`,
  ];

  if (input.material === 'component' && input.packaging === 'inner') {
    parts.push(`7E${trim(input.msl).toUpperCase()}`);
  }

  return parts.join('|');
}

/**
 * @param {import('./validators.js').LabelFields} fields
 * @returns {Record<string, { di: string, hr: string, payload: string }>}
 */
export function buildFieldEncodings(fields) {
  const qtyHr = formatQuantity(fields.quantity);
  const dateHr = fields.dateMode === '2D' ? trim(fields.expiry) : trim(fields.dateCode);
  const dateDi = fields.dateMode === '2D' ? '2D' : '9D';
  const msl = trim(fields.msl).toUpperCase();

  /** @type {Record<string, { di: string, hr: string, payload: string }>} */
  const map = {
    po: { di: 'K', hr: trim(fields.po), payload: encode1D('K', fields.po) },
    packingSlip: {
      di: '11K',
      hr: trim(fields.packingSlip),
      payload: encode1D('11K', fields.packingSlip),
    },
    manufacturer: {
      di: '21P',
      hr: trim(fields.manufacturer),
      payload: encode1D('21P', fields.manufacturer),
    },
    origin: { di: '4L', hr: trim(fields.origin), payload: encode1D('4L', fields.origin) },
    partNumber: {
      di: 'P',
      hr: trim(fields.partNumber),
      payload: encode1D('P', fields.partNumber),
    },
    mpn: { di: '1P', hr: trim(fields.mpn), payload: encode1D('1P', fields.mpn) },
    lot: { di: '1T', hr: trim(fields.lot), payload: encode1D('1T', fields.lot) },
    date: { di: dateDi, hr: dateHr, payload: encode1D(dateDi, dateHr) },
    quantity: { di: '7Q', hr: qtyHr, payload: encode1D('7Q', qtyHr) },
    serial: { di: 'S', hr: trim(fields.serial), payload: encode1D('S', fields.serial) },
    msl: { di: '7E', hr: msl, payload: encode1D('7E', msl) },
    invoice: {
      di: '',
      hr: trim(fields.invoice),
      payload: encodeInvoice1D(fields.invoice),
    },
    slipExpiry: {
      di: '',
      hr: trim(fields.slipExpiry),
      payload: encodeInvoice1D(fields.slipExpiry),
    },
  };
  return map;
}

/**
 * Packing slip part-list line encodings (part number + quantity)
 * @param {{ partNumber: string, quantity: string }} line
 * @returns {{ partNumber: { hr: string, payload: string }, quantity: { hr: string, payload: string } }}
 */
export function encodePartLine(line) {
  const pn = trim(line.partNumber);
  const qty = quantityDigits(line.quantity);
  return {
    partNumber: { hr: pn, payload: encode1D('P', pn) },
    quantity: { hr: qty, payload: encode1D('7Q', qty) },
  };
}

/** @deprecated use encodePartLine */
export function encodeLotLine(line) {
  return encodePartLine({
    partNumber: line.lot || line.partNumber || '',
    quantity: line.quantity || '',
  });
}

/** Hardware sample (Figure 15) */
export const SAMPLE_HARDWARE = {
  document: /** @type {'label'} */ ('label'),
  material: /** @type {'hardware'} */ ('hardware'),
  packaging: /** @type {'outer'} */ ('outer'),
  dateMode: /** @type {'9D'} */ ('9D'),
  po: '4512345678',
  packingSlip: '200123-01XYZ',
  partNumber: '541-500002',
  mpn: 'ABC1234',
  manufacturer: 'MICRON',
  origin: 'JP',
  lot: 'BHX12345',
  dateCode: '20210123',
  expiry: '01-23-2021',
  quantity: '3000',
  serial: 'BHX123456-001',
  msl: '3',
  invoice: 'INV-100234',
  includeExpiryOnSlip: false,
  slipExpiry: '01/23/2021',
  partLines: [{ partNumber: '541-500002', quantity: '3000' }],
};

/** Component reel sample (Table 10/11) */
export const SAMPLE_COMPONENT = {
  document: /** @type {'label'} */ ('label'),
  material: /** @type {'component'} */ ('component'),
  packaging: /** @type {'outer'} */ ('outer'),
  dateMode: /** @type {'9D'} */ ('9D'),
  po: '4512345678',
  packingSlip: '200123-01XYZ',
  partNumber: '510-500002',
  mpn: 'ERJ2GEJ220X',
  manufacturer: 'MICRON',
  origin: 'JP',
  lot: '2200001000',
  dateCode: '20190826',
  expiry: '08-26-2020',
  quantity: '3000',
  serial: 'ASM510002PB0000001',
  msl: '3',
  invoice: 'INV-100234',
  includeExpiryOnSlip: false,
  slipExpiry: '08/26/2020',
  partLines: [
    { partNumber: '510-500002', quantity: '2000' },
    { partNumber: '510-500003', quantity: '1000' },
  ],
};

/** Packing slip sample (§2.3) */
export const SAMPLE_PACKING_SLIP = {
  document: /** @type {'packing-slip'} */ ('packing-slip'),
  material: /** @type {'hardware'} */ ('hardware'),
  packaging: /** @type {'outer'} */ ('outer'),
  dateMode: /** @type {'9D'} */ ('9D'),
  po: '4512345678',
  packingSlip: '200123-01XYZ',
  partNumber: '541-500002',
  mpn: 'ABC1234',
  manufacturer: 'MICRON',
  origin: 'JP',
  lot: 'BHX12345',
  dateCode: '20210123',
  expiry: '01-23-2021',
  quantity: '3000',
  serial: 'BHX123456-001',
  msl: '3',
  invoice: 'INV-100234',
  includeExpiryOnSlip: true,
  slipExpiry: '01/23/2021',
  partLines: [
    { partNumber: '541-500002', quantity: '2000' },
    { partNumber: '541-500003', quantity: '1000' },
  ],
};

/** @deprecated use SAMPLE_HARDWARE */
export const SAMPLE_FIELDS = SAMPLE_HARDWARE;
