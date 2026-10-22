/**
 * Render packing slip document with barcodes and part list.
 */

import { clearCanvas, drawCode128 } from './barcodes.js';
import { encodePartLine, quantityDigits } from './encode.js';
import { trim } from './validators.js';

/**
 * @param {HTMLElement|null} row
 * @param {string} hr
 * @param {string} payload
 */
function paintSlipRow(row, hr, payload) {
  if (!row) return;
  const canvas = row.querySelector('.bc-1d');
  const hrEl = row.querySelector('.hr-value');
  if (hrEl) hrEl.textContent = hr || '';
  if (canvas instanceof HTMLCanvasElement) {
    if (hr) {
      drawCode128(canvas, payload);
    } else {
      clearCanvas(canvas);
    }
  }
}

/**
 * @param {HTMLElement} root
 * @param {import('./validators.js').LabelFields} fields
 * @param {Record<string, { di: string, hr: string, payload: string }>} encodings
 */
export function renderPackingSlip(root, fields, encodings) {
  const qty = quantityDigits(fields.quantity);
  const meta = {
    packingSlip: encodings.packingSlip,
    invoice: encodings.invoice,
    po: encodings.po,
    quantity: {
      hr: qty,
      payload: `*7Q${qty}*`,
    },
  };

  const keys = Object.keys(meta);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    paintSlipRow(root.querySelector(`[data-slip="${key}"]`), meta[key].hr, meta[key].payload);
  }

  const expiryBlock = root.querySelector('[data-slip-expiry-block]');
  if (expiryBlock) {
    const show = !!fields.includeExpiryOnSlip;
    expiryBlock.classList.toggle('hidden', !show);
    if (show) {
      paintSlipRow(
        root.querySelector('[data-slip="slipExpiry"]'),
        encodings.slipExpiry.hr,
        encodings.slipExpiry.payload
      );
    }
  }

  const tbody = root.querySelector('#part-list-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  const lines = fields.partLines || [];
  for (let i = 0; i < lines.length; i++) {
    const enc = encodePartLine(lines[i]);
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="part-idx">' +
      (i + 1) +
      '</td>' +
      '<td class="part-cell">' +
      '<canvas class="bc-1d" width="1" height="1"></canvas>' +
      '<div class="hr-value"></div>' +
      '</td>' +
      '<td class="part-cell">' +
      '<canvas class="bc-1d" width="1" height="1"></canvas>' +
      '<div class="hr-value"></div>' +
      '</td>';

    const cells = tr.querySelectorAll('.part-cell');
    const pnCanvas = cells[0].querySelector('.bc-1d');
    const pnHr = cells[0].querySelector('.hr-value');
    const qtyCanvas = cells[1].querySelector('.bc-1d');
    const qtyHr = cells[1].querySelector('.hr-value');
    if (pnHr) pnHr.textContent = enc.partNumber.hr;
    if (qtyHr) qtyHr.textContent = enc.quantity.hr;
    if (pnCanvas instanceof HTMLCanvasElement) {
      drawCode128(pnCanvas, enc.partNumber.payload, { height: 6 });
    }
    if (qtyCanvas instanceof HTMLCanvasElement) {
      drawCode128(qtyCanvas, enc.quantity.payload, { height: 6 });
    }
    tbody.appendChild(tr);
  }

  const titleEl = root.querySelector('#slip-title-number');
  if (titleEl) {
    titleEl.textContent = trim(fields.packingSlip) || '—';
  }
}
