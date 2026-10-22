import { validateAll } from './validators.js';
import { buildFieldEncodings, encode2D } from './encode.js';
import { renderLabel } from './render-label.js';
import { renderPackingSlip } from './render-packing-slip.js';
import { cloneWithCanvases, replaceCanvasesWithImages } from './barcodes.js';
import {
  buildSavedPayload,
  loadFromLocalStorage,
  parseSavedJson,
  saveToLocalStorage,
  toDownloadFilename,
} from './storage.js';
import {
  emptyShipment,
  innerLabelCount,
  listLabelTargets,
  MAX_INNER_LABELS,
  normalizeInnerMode,
  parseOuterQty,
  parsePreviewId,
  previewIdForPackage,
  syncPackagesFromPartList,
  toLabelFields,
  toSlipFields,
} from './shipment.js';
import { applyParsedPoToShipment, parsePoText } from './parse-po.js';
import { extractTextFromPdfStructured } from './load-po-pdf.js';

/** @type {import('./shipment.js').Shipment} */
let shipment = emptyShipment();
/** @type {string} */
let previewTarget = 'slip';
/** @type {ReturnType<typeof setTimeout>|null} */
let autoSaveTimer = null;
/** @type {string|null} */
let lastSavedAt = null;
let rebuildingPackagesUi = false;

/**
 * @returns {import('./validators.js').PartLine[]}
 */
function readPartLinesFromDom() {
  const container = document.getElementById('part-lines');
  if (!container) return [];
  const rows = container.querySelectorAll('.part-line');
  /** @type {import('./validators.js').PartLine[]} */
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const pn = /** @type {HTMLInputElement|null} */ (rows[i].querySelector('[data-part]'));
    const qty = /** @type {HTMLInputElement|null} */ (rows[i].querySelector('[data-qty]'));
    lines.push({
      partNumber: pn ? pn.value : '',
      quantity: qty ? qty.value : '',
    });
  }
  return lines;
}

/**
 * @param {import('./validators.js').PartLine[]} lines
 */
function writePartLinesDom(lines) {
  const container = document.getElementById('part-lines');
  if (!container) return;
  container.innerHTML = '';
  const list = lines && lines.length ? lines : [{ partNumber: '', quantity: '' }];
  for (let i = 0; i < list.length; i++) {
    addPartLineRow(list[i].partNumber, list[i].quantity, false);
  }
}

/**
 * @param {string} [partNumber]
 * @param {string} [qty]
 * @param {boolean} [refreshAfter]
 */
function addPartLineRow(partNumber, qty, refreshAfter) {
  const container = document.getElementById('part-lines');
  if (!container) return;
  const idx = container.querySelectorAll('.part-line').length;
  const row = document.createElement('div');
  row.className = 'part-line';
  row.innerHTML =
    '<label class="field">' +
    '<span>Part ' +
    (idx + 1) +
    '</span>' +
    '<input type="text" data-part autocomplete="off" placeholder="541-500002" />' +
    '<span class="error" data-error-for="partLine_' +
    idx +
    '_part"></span>' +
    '</label>' +
    '<label class="field">' +
    '<span>Qty</span>' +
    '<input type="text" data-qty inputmode="numeric" autocomplete="off" />' +
    '<span class="error" data-error-for="partLine_' +
    idx +
    '_qty"></span>' +
    '</label>' +
    '<button type="button" class="btn btn-secondary btn-small btn-remove-part" title="Remove">×</button>';
  /** @type {HTMLInputElement} */ (row.querySelector('[data-part]')).value = partNumber || '';
  /** @type {HTMLInputElement} */ (row.querySelector('[data-qty]')).value = qty || '';
  const removeBtn = row.querySelector('.btn-remove-part');
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      row.remove();
      renumberPartLines();
      onFormChange();
    });
  }
  container.appendChild(row);
  if (refreshAfter) onFormChange();
}

function renumberPartLines() {
  const rows = document.querySelectorAll('#part-lines .part-line');
  for (let i = 0; i < rows.length; i++) {
    const label = rows[i].querySelector('.field span');
    if (label) label.textContent = 'Part ' + (i + 1);
    const errPart = rows[i].querySelector('[data-error-for$="_part"]');
    const errQty = rows[i].querySelector('[data-error-for$="_qty"]');
    if (errPart) errPart.setAttribute('data-error-for', 'partLine_' + i + '_part');
    if (errQty) errQty.setAttribute('data-error-for', 'partLine_' + i + '_qty');
  }
}

function readSharedFromDom() {
  shipment.material = /** @type {'hardware'|'component'} */ (
    /** @type {HTMLSelectElement} */ (document.getElementById('material')).value
  );
  shipment.dateMode = /** @type {'9D'|'2D'} */ (
    /** @type {HTMLSelectElement} */ (document.getElementById('date-mode')).value
  );
  shipment.po = /** @type {HTMLInputElement} */ (document.getElementById('po')).value;
  shipment.packingSlip = /** @type {HTMLInputElement} */ (document.getElementById('packingSlip')).value;
  shipment.invoice = /** @type {HTMLInputElement} */ (document.getElementById('invoice')).value;
  shipment.mpnDefault = /** @type {HTMLInputElement} */ (document.getElementById('mpnDefault')).value;
  shipment.manufacturer = /** @type {HTMLInputElement} */ (document.getElementById('manufacturer')).value;
  shipment.origin = /** @type {HTMLInputElement} */ (document.getElementById('origin')).value;
  shipment.totalQuantity = /** @type {HTMLInputElement} */ (document.getElementById('totalQuantity')).value;
  shipment.includeExpiryOnSlip = /** @type {HTMLInputElement} */ (
    document.getElementById('includeExpiryOnSlip')
  ).checked;
  shipment.slipExpiry = /** @type {HTMLInputElement} */ (document.getElementById('slipExpiry')).value;
  shipment.partLines = readPartLinesFromDom();
}

function writeSharedToDom() {
  /** @type {HTMLSelectElement} */ (document.getElementById('material')).value = shipment.material;
  /** @type {HTMLSelectElement} */ (document.getElementById('date-mode')).value = shipment.dateMode;
  /** @type {HTMLInputElement} */ (document.getElementById('po')).value = shipment.po;
  /** @type {HTMLInputElement} */ (document.getElementById('packingSlip')).value = shipment.packingSlip;
  /** @type {HTMLInputElement} */ (document.getElementById('invoice')).value = shipment.invoice;
  /** @type {HTMLInputElement} */ (document.getElementById('mpnDefault')).value = shipment.mpnDefault;
  /** @type {HTMLInputElement} */ (document.getElementById('manufacturer')).value = shipment.manufacturer;
  /** @type {HTMLInputElement} */ (document.getElementById('origin')).value = shipment.origin;
  /** @type {HTMLInputElement} */ (document.getElementById('totalQuantity')).value =
    shipment.totalQuantity;
  /** @type {HTMLInputElement} */ (document.getElementById('includeExpiryOnSlip')).checked =
    shipment.includeExpiryOnSlip;
  /** @type {HTMLInputElement} */ (document.getElementById('slipExpiry')).value = shipment.slipExpiry;
  writePartLinesDom(shipment.partLines);
}

/**
 * Pull package editor values back into shipment.packages
 */
function readPackagesFromDom() {
  const cards = document.querySelectorAll('#packages-editor .package-card');
  for (let i = 0; i < cards.length; i++) {
    const id = cards[i].getAttribute('data-pkg-id');
    const pkg = shipment.packages.find(function (p) {
      return p.id === id;
    });
    if (!pkg) continue;
    const g = function (name) {
      const el = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (
        cards[i].querySelector('[data-pkg-field="' + name + '"]')
      );
      return el ? el.value : '';
    };
    pkg.mpn = g('mpn');
    pkg.manufacturer = g('manufacturer');
    pkg.origin = g('origin');
    pkg.lot = g('lot');
    pkg.dateCode = g('dateCode');
    pkg.expiry = g('expiry');
    pkg.serial = g('serial');
    pkg.msl = g('msl') || '3';
    const modeEl = /** @type {HTMLInputElement|null} */ (
      cards[i].querySelector('[data-pkg-field="innerMode"]')
    );
    pkg.innerMode = modeEl && modeEl.checked ? 'each' : 'same';
  }
}

function rebuildPackagesEditor() {
  const host = document.getElementById('packages-editor');
  if (!host) return;
  rebuildingPackagesUi = true;
  host.innerHTML = '';

  if (!shipment.packages.length) {
    host.innerHTML = '<p class="hint">No packages yet — add parts with a part number and quantity above.</p>';
    rebuildingPackagesUi = false;
    return;
  }

  const dateMode = shipment.dateMode;
  for (let i = 0; i < shipment.packages.length; i++) {
    const pkg = shipment.packages[i];
    const card = document.createElement('details');
    card.className = 'package-card';
    card.setAttribute('data-pkg-id', pkg.id);
    if (i === 0) card.open = true;

    const showMsl = shipment.material === 'component';
    const each = normalizeInnerMode(pkg.innerMode) === 'each';
    const nInner = innerLabelCount(pkg);
    const outerQty = parseOuterQty(pkg);
    const tag = each
      ? '1 Outer + ' + nInner + ' Inner' + (outerQty > MAX_INNER_LABELS ? '*' : '')
      : 'Outer + Inner';
    const innerHint = each
      ? 'Outer qty ' +
        outerQty +
        ' → ' +
        nInner +
        ' inner label(s) at qty 1 each' +
        (outerQty > MAX_INNER_LABELS
          ? ' (capped at ' + MAX_INNER_LABELS + ' for print).'
          : '.')
      : 'One outer carton label + one inner label (same quantity).';

    card.innerHTML =
      '<summary>' +
      '<span class="pkg-summary-text"><strong>Part ' +
      (i + 1) +
      '</strong> · ' +
      escapeHtml(pkg.partNumber || '(no PN)') +
      ' · qty ' +
      escapeHtml(pkg.quantity || '—') +
      ' <span class="pkg-tag">' +
      escapeHtml(tag) +
      '</span></span>' +
      '<span class="pkg-chevron" aria-hidden="true">▾</span>' +
      '</summary>' +
      '<div class="package-body">' +
      '<label class="field checkbox-field">' +
      '<input type="checkbox" data-pkg-field="innerMode" value="each"' +
      (each ? ' checked' : '') +
      ' />' +
      '<span>Individually packaged (1 inner label per unit)</span>' +
      '</label>' +
      '<p class="hint pkg-inner-hint">' +
      escapeHtml(innerHint) +
      '</p>' +
      fieldHtml('mpn', '(1P) Manufacturer Part Number', pkg.mpn, false) +
      fieldHtml('manufacturer', '(21P) Manufacturer', pkg.manufacturer, false) +
      fieldHtml('origin', '(4L) Origin', pkg.origin, false) +
      fieldHtml('lot', '(1T) Lot Number <em class="limit">optional</em>', pkg.lot, false) +
      (dateMode === '2D'
        ? fieldHtml('expiry', '(2D) Expiry MM-DD-YYYY <em class="limit">optional</em>', pkg.expiry, false)
        : fieldHtml(
            'dateCode',
            '(9D) Date Code YYYYMMDD <em class="limit">optional</em>',
            pkg.dateCode,
            false
          )) +
      fieldHtml('serial', '(S) Serial Number <em class="limit">optional</em>', pkg.serial, false) +
      (showMsl
        ? '<label class="field"><span>(7E) MSL (inner 2D)</span>' +
          '<select data-pkg-field="msl">' +
          mslOptions(pkg.msl) +
          '</select></label>'
        : '<input type="hidden" data-pkg-field="msl" value="' +
          escapeAttr(pkg.msl || '3') +
          '" />') +
      '<p class="error pkg-error" data-error-for="package_' +
      i +
      '"></p>' +
      '<div class="pkg-actions">' +
      '<button type="button" class="btn btn-secondary btn-small" data-preview="' +
      previewIdForPackage(i, 'outer') +
      '">Preview outer</button>' +
      '<button type="button" class="btn btn-secondary btn-small" data-preview="' +
      (each ? previewIdForPackage(i, 'inner', 0) : previewIdForPackage(i, 'inner')) +
      '">Preview inner' +
      (each ? ' 1/' + nInner : '') +
      '</button>' +
      '</div></div>';

    host.appendChild(card);
  }

  host.querySelectorAll('[data-preview]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      previewTarget = btn.getAttribute('data-preview') || 'slip';
      refresh();
    });
  });

  rebuildingPackagesUi = false;
}

/**
 * @param {string} name
 * @param {string} label
 * @param {string} value
 * @param {boolean} ro
 */
function fieldHtml(name, label, value, ro) {
  return (
    '<label class="field"><span>' +
    label +
    '</span><input type="text" data-pkg-field="' +
    name +
    '" value="' +
    escapeAttr(value || '') +
    '"' +
    (ro ? ' readonly' : '') +
    ' autocomplete="off" /></label>'
  );
}

/**
 * @param {string} selected
 */
function mslOptions(selected) {
  const vals = ['1', '2', '2A', '3', '4', '5', '5A', '6'];
  return vals
    .map(function (v) {
      return (
        '<option value="' +
        v +
        '"' +
        (v === selected ? ' selected' : '') +
        '>' +
        v +
        '</option>'
      );
    })
    .join('');
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {string} s
 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function syncPackagesFromPartListUi() {
  shipment.packages = syncPackagesFromPartList(shipment.partLines, shipment.packages, {
    mpnDefault: shipment.mpnDefault,
    manufacturer: shipment.manufacturer,
    origin: shipment.origin,
    dateMode: shipment.dateMode,
  });
}

function updatePreviewSelect() {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('preview-target'));
  if (!sel) return;
  const prev = previewTarget;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = 'slip';
  opt0.textContent = 'Packing slip';
  sel.appendChild(opt0);
  const targets = listLabelTargets(shipment);
  for (let i = 0; i < targets.length; i++) {
    const o = document.createElement('option');
    o.value = targets[i].id;
    o.textContent = targets[i].title;
    sel.appendChild(o);
  }
  const exists = Array.prototype.some.call(sel.options, function (o) {
    return o.value === prev;
  });
  previewTarget = exists ? prev : 'slip';
  sel.value = previewTarget;
}

function formatSavedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (err) {
    return iso;
  }
}

function updateSaveStatus(iso, extra) {
  const el = document.getElementById('save-status');
  if (!el) return;
  if (iso) lastSavedAt = iso;
  if (lastSavedAt) {
    el.textContent =
      'Last saved: ' +
      formatSavedAt(lastSavedAt) +
      '.' +
      (extra ? ' ' + extra : '');
  } else {
    el.textContent = 'No saved session yet.' + (extra ? ' ' + extra : '');
  }
}

function persistLocal(silent) {
  const result = saveToLocalStorage(window.localStorage, shipmentToPersistable());
  if (result.ok && result.savedAt) {
    updateSaveStatus(result.savedAt, silent ? '' : 'Saved.');
    return true;
  }
  if (!silent) updateSaveStatus(lastSavedAt, result.message || 'Save failed.');
  return false;
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function () {
    persistLocal(true);
  }, 400);
}

/**
 * Persist as LabelFields-compatible envelope for storage helpers.
 */
function shipmentToPersistable() {
  return Object.assign({}, toSlipFields(shipment), {
    document: 'shipment',
    shipment: shipment,
  });
}

function showErrors(errors) {
  document.querySelectorAll('[data-error-for]').forEach(function (el) {
    el.textContent = '';
  });
  document.querySelectorAll('.invalid').forEach(function (el) {
    el.classList.remove('invalid');
  });
  Object.keys(errors).forEach(function (key) {
    const errEl = document.querySelector('[data-error-for="' + key + '"]');
    if (errEl) errEl.textContent = errors[key];
    const input = document.getElementById(key);
    if (input) input.classList.add('invalid');

    // Highlight package fields mentioned in package_* errors
    const pkgMatch = /^package_(\d+)$/.exec(key);
    if (pkgMatch) {
      const card = document.querySelectorAll('#packages-editor .package-card')[Number(pkgMatch[1])];
      if (card) {
        card.open = true;
        card.classList.add('package-card-error');
        ['lot', 'serial', 'dateCode', 'expiry', 'msl', 'mpn', 'origin', 'manufacturer'].forEach(
          function (field) {
            const el = /** @type {HTMLInputElement|null} */ (
              card.querySelector('[data-pkg-field="' + field + '"]')
            );
            if (!el) return;
            const msg = errors[key] || '';
            // Highlight fields whose validation message is present in the package error text
            if (
              (field === 'lot' && /Lot/i.test(msg)) ||
              (field === 'serial' && /Serial/i.test(msg)) ||
              (field === 'dateCode' && /Date Code/i.test(msg)) ||
              (field === 'expiry' && /Expiry/i.test(msg)) ||
              (field === 'mpn' && /Manufacturer Part/i.test(msg)) ||
              (field === 'origin' && /Origin/i.test(msg)) ||
              (field === 'manufacturer' && /Manufacturer(?! Part)/i.test(msg))
            ) {
              el.classList.add('invalid');
            }
          }
        );
      }
    }
  });
  document.querySelectorAll('#packages-editor .package-card').forEach(function (card, idx) {
    if (!errors['package_' + idx]) card.classList.remove('package-card-error');
  });
}

function collectValidation() {
  /** @type {Record<string, string>} */
  const errors = {};
  const slip = toSlipFields(shipment);
  const slipResult = validateAll(slip);
  Object.assign(errors, slipResult.errors);

  for (let i = 0; i < shipment.packages.length; i++) {
    const pkg = shipment.packages[i];
    const outer = toLabelFields(shipment, pkg, 'outer');
    const inner = toLabelFields(shipment, pkg, 'inner');
    const oRes = validateAll(outer);
    const iRes = validateAll(inner);
    if (!oRes.ok || !iRes.ok) {
      const detail = Object.assign({}, oRes.errors, iRes.errors);
      const parts = Object.keys(detail).map(function (k) {
        return detail[k];
      });
      errors['package_' + i] =
        'Part ' +
        (i + 1) +
        ' (' +
        (pkg.partNumber || '?') +
        '): ' +
        (parts.length ? parts.join(' ') : 'has invalid label fields.');
    }
  }

  return { ok: Object.keys(errors).length === 0, errors: errors, slipOk: slipResult.ok };
}

/**
 * @param {Record<string, string>} errors
 * @returns {string}
 */
function formatStatusErrors(errors) {
  const keys = Object.keys(errors);
  if (!keys.length) return '';
  const first = errors[keys[0]];
  if (keys.length === 1) return first;
  return first + ' (+' + (keys.length - 1) + ' more)';
}

function refreshPreview() {
  const parsed = parsePreviewId(previewTarget) || { kind: 'slip' };
  const labelRoot = document.getElementById('label-root');
  const slipRoot = document.getElementById('packing-slip-root');
  const badge = document.getElementById('preview-badge');
  const dmDetails = document.getElementById('dm-details');
  const dmPayloadEl = document.getElementById('dm-payload');

  if (parsed.kind === 'slip') {
    if (labelRoot) labelRoot.classList.add('hidden');
    if (slipRoot) slipRoot.classList.remove('hidden');
    if (badge) badge.textContent = 'Packing Slip';
    if (dmDetails) dmDetails.classList.add('hidden');
    const slipFields = toSlipFields(shipment);
    const enc = buildFieldEncodings(slipFields);
    if (slipRoot) renderPackingSlip(slipRoot, slipFields, enc);
    if (dmPayloadEl) dmPayloadEl.textContent = '';
    return;
  }

  const pkg = shipment.packages[parsed.index];
  if (!pkg) {
    previewTarget = 'slip';
    refreshPreview();
    return;
  }
  const unitIndex = parsed.unitIndex || 0;
  const fields = toLabelFields(shipment, pkg, parsed.packaging, unitIndex);
  const enc = buildFieldEncodings(fields);
  const dm = encode2D(fields);
  if (slipRoot) slipRoot.classList.add('hidden');
  if (labelRoot) {
    labelRoot.classList.remove('hidden');
    renderLabel(labelRoot, fields, enc, dm);
  }
  if (badge) {
    if (parsed.packaging === 'outer') {
      badge.textContent = 'Part ' + (parsed.index + 1) + ' · Outer';
    } else if (normalizeInnerMode(pkg.innerMode) === 'each') {
      badge.textContent =
        'Part ' +
        (parsed.index + 1) +
        ' · Inner ' +
        (unitIndex + 1) +
        '/' +
        innerLabelCount(pkg) +
        ' (qty 1)';
    } else {
      badge.textContent = 'Part ' + (parsed.index + 1) + ' · Inner';
    }
  }
  if (dmDetails) dmDetails.classList.remove('hidden');
  if (dmPayloadEl) dmPayloadEl.textContent = dm;
}

function refresh() {
  if (!rebuildingPackagesUi) {
    readPackagesFromDom();
  }
  readSharedFromDom();
  syncPackagesFromPartListUi();

  const expiryField = document.getElementById('field-slip-expiry');
  if (expiryField) {
    expiryField.classList.toggle('hidden', !shipment.includeExpiryOnSlip);
  }

  const countHint = document.getElementById('package-count-hint');
  if (countHint) {
    const n = shipment.packages.length;
    let innerTotal = 0;
    for (let i = 0; i < shipment.packages.length; i++) {
      innerTotal += innerLabelCount(shipment.packages[i]);
    }
    countHint.textContent = n
      ? n +
        ' part(s) → ' +
        (n + innerTotal) +
        ' labels (' +
        n +
        ' outer + ' +
        innerTotal +
        ' inner). Complete section 3 for each part.'
      : 'Add parts to generate labels.';
  }

  // Rebuild package cards only when count/ids/mode/material change to avoid focus loss
  const host = document.getElementById('packages-editor');
  const currentIds =
    shipment.packages
      .map(function (p) {
        return p.id + ':' + normalizeInnerMode(p.innerMode);
      })
      .join('|') +
    '|' +
    shipment.dateMode +
    '|' +
    shipment.material;
  if (!host || host.getAttribute('data-sig') !== currentIds) {
    rebuildPackagesEditor();
    if (host) host.setAttribute('data-sig', currentIds);
  } else {
    const cards = host.querySelectorAll('.package-card');
    for (let i = 0; i < cards.length && i < shipment.packages.length; i++) {
      const pkg = shipment.packages[i];
      const each = normalizeInnerMode(pkg.innerMode) === 'each';
      const nInner = innerLabelCount(pkg);
      const outerQty = parseOuterQty(pkg);
      const tag = each ? '1 Outer + ' + nInner + ' Inner' : 'Outer + Inner';
      const sum = cards[i].querySelector('summary');
      if (sum) {
        sum.innerHTML =
          '<span class="pkg-summary-text"><strong>Part ' +
          (i + 1) +
          '</strong> · ' +
          escapeHtml(pkg.partNumber || '(no PN)') +
          ' · qty ' +
          escapeHtml(pkg.quantity || '—') +
          ' <span class="pkg-tag">' +
          escapeHtml(tag) +
          '</span></span>' +
          '<span class="pkg-chevron" aria-hidden="true">▾</span>';
      }
      const hint = cards[i].querySelector('.pkg-inner-hint');
      if (hint) {
        hint.textContent = each
          ? 'Outer qty ' +
            outerQty +
            ' → ' +
            nInner +
            ' inner label(s) at qty 1 each' +
            (outerQty > MAX_INNER_LABELS
              ? ' (capped at ' + MAX_INNER_LABELS + ' for print).'
              : '.')
          : 'One outer carton label + one inner label (same quantity).';
      }
      const innerBtn = cards[i].querySelector('[data-preview*="-inner"]');
      if (innerBtn) {
        innerBtn.setAttribute(
          'data-preview',
          each ? previewIdForPackage(i, 'inner', 0) : previewIdForPackage(i, 'inner')
        );
        innerBtn.textContent = each ? 'Preview inner 1/' + nInner : 'Preview inner';
      }
    }
  }

  updatePreviewSelect();
  const result = collectValidation();
  showErrors(result.errors);

  const status = document.getElementById('status-message');
  const printBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-print'));
  const printAllBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-print-all'));
  if (result.ok) {
    if (status) {
      status.className = 'status ok';
      status.textContent = 'Valid — packing slip and all outer/inner labels are ready.';
    }
    if (printBtn) printBtn.disabled = false;
    if (printAllBtn) printAllBtn.disabled = false;
  } else {
    if (status) {
      status.className = 'status warn';
      status.textContent =
        formatStatusErrors(result.errors) + ' Packing slip can still be previewed.';
    }
    if (printBtn) printBtn.disabled = false;
    if (printAllBtn) printAllBtn.disabled = !result.ok;
  }

  refreshPreview();
  scheduleAutoSave();
}

function onFormChange() {
  refresh();
}

function applyShipment(next) {
  shipment = next;
  writeSharedToDom();
  syncPackagesFromPartListUi();
  const host = document.getElementById('packages-editor');
  if (host) host.removeAttribute('data-sig');
  rebuildPackagesEditor();
  previewTarget = 'slip';
  refresh();
}

function loadSample() {
  applyShipment({
    material: 'hardware',
    dateMode: '9D',
    po: '4512345678',
    packingSlip: '200123-01XYZ',
    invoice: 'INV-100234',
    mpnDefault: 'ABC1234',
    manufacturer: 'MICRON',
    origin: 'JP',
    totalQuantity: '3000',
    includeExpiryOnSlip: true,
    slipExpiry: '01/23/2021',
    partLines: [
      { partNumber: '541-500002', quantity: '2000' },
      { partNumber: '541-500003', quantity: '1000' },
    ],
    packages: [],
  });
  // After sync, fill sample lot/serial per package
  shipment.packages.forEach(function (pkg, i) {
    pkg.mpn = i === 0 ? 'ABC1234' : 'ABC5678';
    pkg.manufacturer = 'MICRON';
    pkg.origin = 'JP';
    pkg.lot = i === 0 ? 'BHX12345' : 'BHX12346';
    pkg.dateCode = '20210123';
    pkg.expiry = '01-23-2021';
    pkg.serial = i === 0 ? 'BHX123456-001' : 'BHX123456-002';
    pkg.msl = '3';
  });
  const host = document.getElementById('packages-editor');
  if (host) host.removeAttribute('data-sig');
  rebuildPackagesEditor();
  refresh();
}

function clearForm() {
  applyShipment(emptyShipment());
}

function saveData() {
  readSharedFromDom();
  readPackagesFromDom();
  syncPackagesFromPartListUi();
  persistLocal(true);
  const payload = buildSavedPayload(shipmentToPersistable());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = toDownloadFilename(toSlipFields(shipment));
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  updateSaveStatus(payload.savedAt, 'JSON backup downloaded.');
}

function triggerLoadFile() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('file-load'));
  if (input) {
    input.value = '';
    input.click();
  }
}

function triggerLoadPo() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('file-po'));
  if (input) {
    input.value = '';
    input.click();
  }
}

/**
 * @param {Event} ev
 */
async function onPoFileSelected(ev) {
  const input = /** @type {HTMLInputElement} */ (ev.target);
  const file = input.files && input.files[0];
  if (!file) return;

  const status = document.getElementById('status-message');
  if (status) {
    status.className = 'status warn';
    status.textContent = 'Reading PO PDF…';
  }

  try {
    const buffer = await file.arrayBuffer();
    const text = await extractTextFromPdfStructured(buffer);
    const parsed = parsePoText(text);
    readSharedFromDom();
    readPackagesFromDom();
    const applied = applyParsedPoToShipment(parsed, shipment);
    if (!parsed.lines.length) {
      if (status) {
        status.className = 'status error';
        status.textContent =
          'Could not read line items from this PDF. Use an Ariba/SAP Business Network PO export.';
      }
      updateSaveStatus(lastSavedAt, 'PO load failed: ' + file.name);
      return;
    }
    applyShipment(applied.shipment);
    persistLocal(true);
    const note = applied.warnings.filter(Boolean).join(' ');
    if (status) {
      status.className = 'status ok';
      status.textContent =
        'Loaded PO ' +
        (applied.shipment.po || '') +
        ' — ' +
        applied.shipment.partLines.length +
        ' part(s). ' +
        note;
    }
    updateSaveStatus(lastSavedAt, 'PO loaded: ' + file.name);
  } catch (err) {
    console.warn('PO load failed', err);
    if (status) {
      status.className = 'status error';
      status.textContent =
        'Failed to read PO PDF. Check the file and network access to the PDF.js CDN.';
    }
    updateSaveStatus(lastSavedAt, 'PO load error: ' + file.name);
  }
}

function onLoadFileSelected(ev) {
  const input = /** @type {HTMLInputElement} */ (ev.target);
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    const parsed = parseSavedJson(String(reader.result || ''));
    if (!parsed.ok) {
      updateSaveStatus(lastSavedAt, parsed.message);
      return;
    }
    const loaded = normalizeLoadedShipment(parsed.payload.fields);
    applyShipment(loaded);
    persistLocal(true);
    updateSaveStatus(parsed.payload.savedAt, 'Loaded: ' + file.name);
  };
  reader.readAsText(file);
}

/**
 * @param {any} fields
 * @returns {import('./shipment.js').Shipment}
 */
function normalizeLoadedShipment(fields) {
  if (fields && fields.shipment && typeof fields.shipment === 'object') {
    const s = Object.assign(emptyShipment(), fields.shipment);
    const rawPkgs = Array.isArray(s.packages) ? s.packages : [];
    for (let i = 0; i < rawPkgs.length; i++) {
      rawPkgs[i].innerMode = normalizeInnerMode(rawPkgs[i].innerMode);
    }
    s.packages = syncPackagesFromPartList(s.partLines, rawPkgs, s);
    return s;
  }
  // Legacy single-document save → shipment
  const s = emptyShipment();
  s.material = fields.material === 'component' ? 'component' : 'hardware';
  s.dateMode = fields.dateMode === '2D' ? '2D' : '9D';
  s.po = fields.po || '';
  s.packingSlip = fields.packingSlip || '';
  s.invoice = fields.invoice || '';
  s.mpnDefault = fields.mpn || '';
  s.manufacturer = fields.manufacturer || '';
  s.origin = fields.origin || '';
  s.totalQuantity = fields.quantity || '';
  s.includeExpiryOnSlip = !!fields.includeExpiryOnSlip;
  s.slipExpiry = fields.slipExpiry || '';
  s.partLines =
    fields.partLines && fields.partLines.length
      ? fields.partLines
      : [{ partNumber: fields.partNumber || '', quantity: fields.quantity || '' }];
  s.packages = syncPackagesFromPartList(s.partLines, [], s);
  if (s.packages[0]) {
    s.packages[0].lot = fields.lot || '';
    s.packages[0].serial = fields.serial || '';
    s.packages[0].dateCode = fields.dateCode || '';
    s.packages[0].expiry = fields.expiry || '';
    s.packages[0].msl = fields.msl || '3';
    s.packages[0].mpn = fields.mpn || s.mpnDefault;
  }
  return s;
}

/**
 * Snapshot a live preview root for print (preserves barcodes).
 * @param {HTMLElement} source
 * @returns {HTMLElement}
 */
function snapshotForPrint(source) {
  const clone = cloneWithCanvases(source);
  clone.id = '';
  clone.classList.remove('hidden');
  // Images survive print engines better than canvas bitmaps
  replaceCanvasesWithImages(clone);
  return clone;
}

/**
 * Render a preview target into the live DOM, then snapshot it for print.
 * @param {string} targetId
 * @returns {HTMLElement|null}
 */
function renderAndSnapshot(targetId) {
  const saved = previewTarget;
  previewTarget = targetId;
  refreshPreview();
  const parsed = parsePreviewId(targetId) || { kind: 'slip' };
  const source =
    parsed.kind === 'slip'
      ? document.getElementById('packing-slip-root')
      : document.getElementById('label-root');
  const snap = source ? snapshotForPrint(source) : null;
  previewTarget = saved;
  refreshPreview();
  return snap;
}

function finishPrintJob() {
  document.body.classList.add('print-all-mode');
  // Allow images to decode before the print dialog opens
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      window.print();
    });
  });
  window.addEventListener(
    'afterprint',
    function () {
      document.body.classList.remove('print-all-mode');
      const root = document.getElementById('print-all-root');
      if (root) root.innerHTML = '';
    },
    { once: true }
  );
}

function printCurrent() {
  persistLocal(true);
  const root = document.getElementById('print-all-root');
  if (!root) return;
  root.innerHTML = '';

  const snap = renderAndSnapshot(previewTarget);
  if (!snap) return;
  root.appendChild(wrapPrintPage(snap, ''));
  finishPrintJob();
}

function printAll() {
  const result = collectValidation();
  if (!result.ok) {
    refresh();
    return;
  }
  persistLocal(true);
  const root = document.getElementById('print-all-root');
  if (!root) return;
  root.innerHTML = '';

  const slipSnap = renderAndSnapshot('slip');
  if (slipSnap) {
    root.appendChild(wrapPrintPage(slipSnap, 'Packing slip'));
  }

  const targets = listLabelTargets(shipment);
  for (let t = 0; t < targets.length; t++) {
    const snap = renderAndSnapshot(targets[t].id);
    if (!snap) continue;
    root.appendChild(wrapPrintPage(snap, targets[t].title));
  }

  finishPrintJob();
}

/**
 * @param {HTMLElement} el
 * @param {string} title
 */
function wrapPrintPage(el, title) {
  const page = document.createElement('div');
  page.className = 'print-page';
  const h = document.createElement('div');
  h.className = 'print-page-title no-screen';
  h.textContent = title;
  page.appendChild(h);
  page.appendChild(el);
  return page;
}

function bind() {
  const formPanel = document.querySelector('.form-panel');
  if (formPanel) {
    formPanel.addEventListener('input', function () {
      if (rebuildingPackagesUi) return;
      onFormChange();
    });
    formPanel.addEventListener('change', function () {
      if (rebuildingPackagesUi) return;
      onFormChange();
    });
  }

  const previewSel = document.getElementById('preview-target');
  if (previewSel) {
    previewSel.addEventListener('change', function () {
      previewTarget = /** @type {HTMLSelectElement} */ (previewSel).value;
      refreshPreview();
    });
  }

  document.getElementById('btn-sample').addEventListener('click', loadSample);
  document.getElementById('btn-clear').addEventListener('click', clearForm);
  document.getElementById('btn-save').addEventListener('click', saveData);
  document.getElementById('btn-load').addEventListener('click', triggerLoadFile);
  document.getElementById('file-load').addEventListener('change', onLoadFileSelected);
  const btnPo = document.getElementById('btn-load-po');
  if (btnPo) btnPo.addEventListener('click', triggerLoadPo);
  const btnPoInline = document.getElementById('btn-load-po-inline');
  if (btnPoInline) btnPoInline.addEventListener('click', triggerLoadPo);
  const filePo = document.getElementById('file-po');
  if (filePo) filePo.addEventListener('change', onPoFileSelected);
  document.getElementById('btn-print').addEventListener('click', printCurrent);
  document.getElementById('btn-print-all').addEventListener('click', printAll);
  document.getElementById('btn-add-part').addEventListener('click', function () {
    addPartLineRow('', '', true);
  });
}

function boot() {
  bind();
  const saved = loadFromLocalStorage(window.localStorage);
  if (saved.ok) {
    applyShipment(normalizeLoadedShipment(saved.payload.fields));
    updateSaveStatus(saved.payload.savedAt, 'Restored previous session.');
  } else {
    loadSample();
    updateSaveStatus(null, '');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
