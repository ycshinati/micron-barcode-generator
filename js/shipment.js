/**
 * Packing-slip-first shipment model.
 * Each part-list line → one package (outer + inner labels, one SAP PN each).
 */

import { trim } from './validators.js';

/**
 * @typedef {Object} PartLine
 * @property {string} partNumber
 * @property {string} quantity
 */

/**
 * @typedef {'same'|'each'} InnerMode
 * - same: 1 inner label, same qty as outer
 * - each: N inner labels (N = outer qty), each with qty 1 (individually packaged)
 */

/** Soft cap so Print all stays usable. */
export const MAX_INNER_LABELS = 200;

/**
 * @typedef {Object} PackageLabel
 * @property {string} id
 * @property {string} partNumber
 * @property {string} quantity
 * @property {InnerMode} innerMode
 * @property {string} mpn
 * @property {string} manufacturer
 * @property {string} origin
 * @property {string} lot
 * @property {string} dateCode
 * @property {string} expiry
 * @property {string} serial
 * @property {string} msl
 */

/**
 * @typedef {Object} Shipment
 * @property {'hardware'|'component'} material
 * @property {'9D'|'2D'} dateMode
 * @property {string} po
 * @property {string} packingSlip
 * @property {string} invoice
 * @property {string} mpnDefault
 * @property {string} manufacturer
 * @property {string} origin
 * @property {string} totalQuantity
 * @property {boolean} includeExpiryOnSlip
 * @property {string} slipExpiry
 * @property {PartLine[]} partLines
 * @property {PackageLabel[]} packages
 */

/**
 * @returns {string}
 */
export function newId() {
  return 'pkg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * @param {Partial<PackageLabel>} [overrides]
 * @returns {PackageLabel}
 */
export function emptyPackage(overrides) {
  return Object.assign(
    {
      id: newId(),
      partNumber: '',
      quantity: '',
      innerMode: 'same',
      mpn: '',
      manufacturer: '',
      origin: '',
      lot: '',
      dateCode: '',
      expiry: '',
      serial: '',
      msl: '3',
    },
    overrides || {}
  );
}

/**
 * @param {string|undefined} mode
 * @returns {InnerMode}
 */
export function normalizeInnerMode(mode) {
  return mode === 'each' ? 'each' : 'same';
}

/**
 * Outer carton quantity as a positive integer (min 1).
 * @param {Pick<PackageLabel, 'quantity'>} pkg
 * @returns {number}
 */
export function parseOuterQty(pkg) {
  const n = parseInt(String(pkg.quantity || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * How many inner label pages to generate for this package.
 * @param {PackageLabel} pkg
 * @returns {number}
 */
export function innerLabelCount(pkg) {
  if (normalizeInnerMode(pkg.innerMode) !== 'each') return 1;
  return Math.min(parseOuterQty(pkg), MAX_INNER_LABELS);
}

/**
 * Quantity printed on an inner label.
 * @param {PackageLabel} pkg
 * @returns {string}
 */
export function innerLabelQuantity(pkg) {
  return normalizeInnerMode(pkg.innerMode) === 'each' ? '1' : String(pkg.quantity || '');
}

/**
 * @returns {Shipment}
 */
export function emptyShipment() {
  return {
    material: 'hardware',
    dateMode: '9D',
    po: '',
    packingSlip: '',
    invoice: '',
    mpnDefault: '',
    manufacturer: '',
    origin: '',
    totalQuantity: '',
    includeExpiryOnSlip: false,
    slipExpiry: '',
    partLines: [{ partNumber: '', quantity: '' }],
    packages: [],
  };
}

/**
 * Rebuild packages from part list, preserving filled fields when part # matches.
 * @param {PartLine[]} partLines
 * @param {PackageLabel[]} existing
 * @param {Pick<Shipment, 'mpnDefault'|'manufacturer'|'origin'|'dateMode'>} shared
 * @returns {PackageLabel[]}
 */
export function syncPackagesFromPartList(partLines, existing, shared) {
  const prev = Array.isArray(existing) ? existing.slice() : [];
  /** @type {PackageLabel[]} */
  const next = [];
  const lines = Array.isArray(partLines) ? partLines : [];

  for (let i = 0; i < lines.length; i++) {
    const pn = trim(lines[i].partNumber);
    const qty = trim(lines[i].quantity);
    if (!pn && !qty) continue;

    let match = null;
    let matchIdx = -1;
    for (let j = 0; j < prev.length; j++) {
      if (trim(prev[j].partNumber) === pn && pn) {
        match = prev[j];
        matchIdx = j;
        break;
      }
    }
    if (matchIdx === -1 && prev[i] && !trim(prev[i].partNumber)) {
      match = prev[i];
      matchIdx = i;
    }
    if (matchIdx >= 0) {
      prev.splice(matchIdx, 1);
    }

    next.push(
      emptyPackage(
        Object.assign({}, match || {}, {
          id: match && match.id ? match.id : newId(),
          partNumber: pn,
          quantity: qty,
          innerMode: match ? normalizeInnerMode(match.innerMode) : 'same',
          mpn: match && trim(match.mpn) ? match.mpn : shared.mpnDefault || '',
          manufacturer:
            match && trim(match.manufacturer) ? match.manufacturer : shared.manufacturer || '',
          origin: match && trim(match.origin) ? match.origin : shared.origin || '',
        })
      )
    );
  }
  return next;
}

/**
 * Build LabelFields for rendering one outer/inner label from a package.
 * @param {Shipment} shipment
 * @param {PackageLabel} pkg
 * @param {'outer'|'inner'} packaging
 * @param {number} [innerUnitIndex] used when innerMode is 'each' (0-based)
 * @returns {import('./validators.js').LabelFields}
 */
export function toLabelFields(shipment, pkg, packaging, innerUnitIndex) {
  void innerUnitIndex; // reserved for per-unit serial later
  const quantity =
    packaging === 'inner' ? innerLabelQuantity(pkg) : String(pkg.quantity || '');
  return {
    document: 'label',
    material: shipment.material,
    packaging: packaging,
    dateMode: shipment.dateMode,
    po: shipment.po,
    packingSlip: shipment.packingSlip,
    partNumber: pkg.partNumber,
    mpn: pkg.mpn || shipment.mpnDefault,
    manufacturer: pkg.manufacturer || shipment.manufacturer,
    origin: pkg.origin || shipment.origin,
    lot: pkg.lot,
    dateCode: pkg.dateCode,
    expiry: pkg.expiry,
    quantity: quantity,
    serial: pkg.serial,
    msl: pkg.msl || '3',
    invoice: shipment.invoice,
    includeExpiryOnSlip: shipment.includeExpiryOnSlip,
    slipExpiry: shipment.slipExpiry,
    partLines: shipment.partLines,
  };
}

/**
 * Build LabelFields for packing slip preview/validation.
 * @param {Shipment} shipment
 * @returns {import('./validators.js').LabelFields}
 */
export function toSlipFields(shipment) {
  const first = shipment.partLines && shipment.partLines[0] ? shipment.partLines[0] : null;
  const total =
    trim(shipment.totalQuantity) ||
    String(
      (shipment.partLines || []).reduce(function (sum, line) {
        const n = parseInt(String(line.quantity || '').replace(/\D/g, ''), 10);
        return sum + (isNaN(n) ? 0 : n);
      }, 0) || ''
    );

  return {
    document: 'packing-slip',
    material: shipment.material,
    packaging: 'outer',
    dateMode: shipment.dateMode,
    po: shipment.po,
    packingSlip: shipment.packingSlip,
    partNumber: first ? first.partNumber : '',
    mpn: shipment.mpnDefault,
    manufacturer: shipment.manufacturer,
    origin: shipment.origin,
    lot: '',
    dateCode: '',
    expiry: '',
    quantity: total,
    serial: '',
    msl: '3',
    invoice: shipment.invoice,
    includeExpiryOnSlip: shipment.includeExpiryOnSlip,
    slipExpiry: shipment.slipExpiry,
    partLines: shipment.partLines,
  };
}

/**
 * Preview target id helpers.
 * Outer: label-{i}-outer
 * Inner (same): label-{i}-inner
 * Inner (each): label-{i}-inner-{unitIndex}
 *
 * @param {number} packageIndex
 * @param {'outer'|'inner'} packaging
 * @param {number} [innerUnitIndex]
 * @returns {string}
 */
export function previewIdForPackage(packageIndex, packaging, innerUnitIndex) {
  if (packaging === 'outer') {
    return 'label-' + packageIndex + '-outer';
  }
  if (innerUnitIndex != null && innerUnitIndex >= 0) {
    return 'label-' + packageIndex + '-inner-' + innerUnitIndex;
  }
  return 'label-' + packageIndex + '-inner';
}

/**
 * @typedef {{ kind: 'slip' }} SlipPreview
 * @typedef {{ kind: 'label', index: number, packaging: 'outer'|'inner', unitIndex: number }} LabelPreview
 */

/**
 * @param {string} previewId
 * @returns {SlipPreview | LabelPreview | null}
 */
export function parsePreviewId(previewId) {
  if (previewId === 'slip') return { kind: 'slip' };
  const each = /^label-(\d+)-inner-(\d+)$/.exec(String(previewId || ''));
  if (each) {
    return {
      kind: 'label',
      index: Number(each[1]),
      packaging: 'inner',
      unitIndex: Number(each[2]),
    };
  }
  const m = /^label-(\d+)-(outer|inner)$/.exec(String(previewId || ''));
  if (!m) return null;
  return {
    kind: 'label',
    index: Number(m[1]),
    packaging: /** @type {'outer'|'inner'} */ (m[2]),
    unitIndex: 0,
  };
}

/**
 * All label preview / print targets for a shipment (expands individually packaged inners).
 * @param {Shipment} shipment
 * @returns {Array<{ id: string, title: string, packageIndex: number, packaging: 'outer'|'inner', unitIndex: number }>}
 */
export function listLabelTargets(shipment) {
  /** @type {Array<{ id: string, title: string, packageIndex: number, packaging: 'outer'|'inner', unitIndex: number }>} */
  const out = [];
  const packages = shipment.packages || [];
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const pn = trim(pkg.partNumber) || 'Part ' + (i + 1);
    out.push({
      id: previewIdForPackage(i, 'outer'),
      title: 'Part ' + (i + 1) + ' · ' + pn + ' · Outer',
      packageIndex: i,
      packaging: 'outer',
      unitIndex: 0,
    });
    const nInner = innerLabelCount(pkg);
    const each = normalizeInnerMode(pkg.innerMode) === 'each';
    for (let u = 0; u < nInner; u++) {
      const id = each ? previewIdForPackage(i, 'inner', u) : previewIdForPackage(i, 'inner');
      const title = each
        ? 'Part ' + (i + 1) + ' · ' + pn + ' · Inner ' + (u + 1) + '/' + nInner
        : 'Part ' + (i + 1) + ' · ' + pn + ' · Inner';
      out.push({
        id: id,
        title: title,
        packageIndex: i,
        packaging: 'inner',
        unitIndex: u,
      });
    }
  }
  return out;
}
