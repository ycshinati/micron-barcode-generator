/**
 * Draw Code 128 and Data Matrix onto the label DOM.
 */

import { clearCanvas, drawBwip, drawCode128 } from './barcodes.js';

/**
 * @param {HTMLElement} labelRoot
 * @param {'outer'|'inner'} packaging
 * @param {string} field
 * @returns {HTMLElement|null}
 */
export function findRow(labelRoot, packaging, field) {
  if (field === 'manufacturer' || field === 'origin') {
    if (packaging === 'inner') {
      return labelRoot.querySelector(`.inner-mfr-origin[data-field="${field}"]`);
    }
    return labelRoot.querySelector(`.label-box-top [data-field="${field}"]`);
  }
  return labelRoot.querySelector(`[data-field="${field}"]`);
}

/**
 * @param {HTMLElement|null} row
 * @param {string} hr
 * @param {string} payload
 * @param {boolean} hasValue
 * @param {boolean} [drawBarcode=true]
 */
function paintRow(row, hr, payload, hasValue, drawBarcode) {
  if (!row) return;
  const canvas = row.querySelector('.bc-1d');
  const hrEl = row.querySelector('.hr-value');
  if (hrEl) {
    hrEl.textContent = hasValue ? hr : '';
  }
  row.setAttribute('data-empty', hasValue ? 'false' : 'true');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  if (hasValue && drawBarcode !== false) {
    drawCode128(canvas, payload);
  } else {
    clearCanvas(canvas);
  }
}

/**
 * @param {HTMLElement} labelRoot
 * @param {import('./validators.js').LabelFields} fields
 * @param {Record<string, { di: string, hr: string, payload: string }>} encodings
 * @param {string} dmPayload
 */
export function renderLabel(labelRoot, fields, encodings, dmPayload) {
  const packaging = fields.packaging;
  const showMsl = fields.material === 'component' && packaging === 'inner';

  labelRoot.classList.toggle('label-outer', packaging === 'outer');
  labelRoot.classList.toggle('label-inner', packaging === 'inner');
  labelRoot.classList.toggle('label-component', fields.material === 'component');
  labelRoot.classList.toggle('show-msl', showMsl);

  const dateTitle = labelRoot.querySelector('#date-row-title');
  if (dateTitle) {
    dateTitle.textContent =
      fields.dateMode === '2D' ? '(2D) Expiration Date' : '(9D) Date Code';
  }

  /** @type {Array<[string, string]>} */
  const outerFields = [
    ['po', 'po'],
    ['packingSlip', 'packingSlip'],
    ['manufacturer', 'manufacturer'],
    ['origin', 'origin'],
  ];

  /** @type {Array<[string, string]>} */
  const sharedBottom = [
    ['partNumber', 'partNumber'],
    ['mpn', 'mpn'],
    ['lot', 'lot'],
    ['date', 'date'],
    ['quantity', 'quantity'],
    ['serial', 'serial'],
  ];

  if (packaging === 'outer') {
    for (let i = 0; i < outerFields.length; i++) {
      const key = outerFields[i][0];
      const enc = encodings[outerFields[i][1]];
      paintRow(findRow(labelRoot, packaging, key), enc.hr, enc.payload, !!enc.hr);
    }
  }

  for (let i = 0; i < sharedBottom.length; i++) {
    const key = sharedBottom[i][0];
    const enc = encodings[sharedBottom[i][1]];
    paintRow(findRow(labelRoot, packaging, key), enc.hr, enc.payload, !!enc.hr);
  }

  if (packaging === 'inner') {
    paintRow(
      findRow(labelRoot, packaging, 'manufacturer'),
      encodings.manufacturer.hr,
      encodings.manufacturer.payload,
      !!encodings.manufacturer.hr
    );
    paintRow(
      findRow(labelRoot, packaging, 'origin'),
      encodings.origin.hr,
      encodings.origin.payload,
      !!encodings.origin.hr
    );
  }

  const mslRow = labelRoot.querySelector('[data-field="msl"]');
  if (mslRow) {
    // Table 11: MSL is human-readable (+ optional logo); 1D not required; 2D includes 7E
    paintRow(mslRow, encodings.msl.hr, encodings.msl.payload, showMsl && !!encodings.msl.hr, false);
  }

  const dmCanvas = labelRoot.querySelector('#bc-dm');
  if (dmCanvas instanceof HTMLCanvasElement) {
    if (dmPayload) {
      drawBwip(dmCanvas, 'datamatrix', dmPayload, {
        scale: 3,
        height: 10,
        width: 10,
      });
    } else {
      clearCanvas(dmCanvas);
    }
  }
}
