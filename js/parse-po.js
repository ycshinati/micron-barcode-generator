/**
 * Parse Micron SAP Business Network / Ariba PO PDF text (English or Korean).
 * Text is extracted client-side (pdf.js); this module is pure string parsing.
 */

import { emptyShipment, syncPackagesFromPartList } from './shipment.js';

/**
 * Ariba columns → label fields (ATI / Micron packing usage):
 *   PO "Customer Part #"       → label (P)  Part Number   (e.g. 830-96265)
 *   PO "Part # / Description"  → label (1P)               (e.g. B00003058)
 *   PO "Manufacturer Part #"   → unused on labels (often blank)
 *
 * @typedef {Object} PoLine
 * @property {string} lineNo
 * @property {string} partNumber  → (P) from Customer Part #
 * @property {string} mpn         → (1P) from Part # / Description
 * @property {string} quantity    Integer string (EA)
 * @property {string} description
 */

/**
 * @typedef {Object} ParsedPo
 * @property {string} po
 * @property {string} language  'en'|'ko'|'unknown'
 * @property {PoLine[]} lines
 * @property {string[]} warnings
 */

/**
 * @param {string} text
 * @returns {string}
 */
function normalizePoText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * @param {string} text
 * @returns {'en'|'ko'|'unknown'}
 */
export function detectPoLanguage(text) {
  const t = normalizePoText(text);
  if (/구매\s*오더|라인\s*번호|수량\s*\(/.test(t)) return 'ko';
  if (/Purchase\s+Order|Line\s*#|Qty\s*\(Unit\)/i.test(t)) return 'en';
  return 'unknown';
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractPoNumber(text) {
  const t = normalizePoText(text);
  const patterns = [
    /Purchase\s+Order:\s*(\d{7,12})/i,
    /구매\s*오더:\s*(\d{7,12})/,
    /Purchase\s+Order\s*\n\s*\((?:New|Changed|변경됨)\)\s*\n\s*(\d{7,12})/i,
    /구매\s*오더\s*\n\s*\(\s*변경됨\s*\)\s*\n\s*(\d{7,12})/,
    /구매\s*오더\s*\n\s*\(\s*신규\s*\)\s*\n\s*(\d{7,12})/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = t.match(patterns[i]);
    if (m) return m[1];
  }
  // Fallback: standalone PO-looking number near header
  const header = t.slice(0, 400);
  const loose = header.match(/\b(45\d{8}|35\d{8}|4\d{9})\b/);
  return loose ? loose[1] : '';
}

/**
 * Micron SAP part tokens (CP00000465, P0000460, …) — not pure long digit MPNs.
 * @param {string} token
 * @returns {boolean}
 */
function looksLikeSapPart(token) {
  const v = String(token || '').trim();
  if (!v) return false;
  if (/^(CP|P)\d{5,}$/i.test(v)) return true;
  if (/^[A-Z]{1,3}\d{5,}$/i.test(v) && !/^\d+$/.test(v)) return true;
  return false;
}

/**
 * Customer Part # tokens (Micron side), e.g. 830-96265 / 840-18724.
 * @param {string} token
 * @returns {boolean}
 */
function looksLikeCustomerPart(token) {
  const v = String(token || '').trim();
  if (!v) return false;
  if (looksLikeSapPart(v)) return false;
  if (/^\d{1,4}$/.test(v)) return false;
  if (/^(EA|USD|STATUS|TYPE)$/i.test(v)) return false;
  if (/^\d{5,}([-./]\d+)*$/.test(v)) return true;
  if (/^[A-Z0-9][-A-Z0-9./]{4,}$/i.test(v)) return true;
  return false;
}

/**
 * @param {string} qtyRaw
 * @returns {string}
 */
function normalizeQty(qtyRaw) {
  const n = Number(String(qtyRaw || '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  // Labels use whole EA counts
  return String(Math.round(n));
}

/**
 * Collapse a window of lines into a single token stream for regex matching.
 * @param {string[]} lines
 * @param {number} start
 * @param {number} count
 * @returns {string}
 */
function windowText(lines, start, count) {
  return lines
    .slice(start, start + count)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Global patterns (no ^) so PDF.js single-stream text still matches.
 * Order matters: more specific first.
 */
const ITEM_PATTERNS = [
  // A3: Line# Schedule# Part#/Desc  MfrPart#  CustomerPart#  Qty (EA)
  // (P)=Customer Part #, (1P)=Part # / Description
  {
    re: /(\d{1,4})\s+(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{4,})\s+(\S+)\s+(\S+)\s+(\d+(?:[.,]\d+)?)\s*\(\s*EA\s*\)/gi,
    map: function (m) {
      if (!looksLikeSapPart(m[3])) return null;
      const customer = looksLikeCustomerPart(m[5])
        ? m[5]
        : looksLikeCustomerPart(m[4])
          ? m[4]
          : '';
      if (!customer && /^\d+(?:[.,]\d+)?$/.test(m[5])) return null;
      return {
        lineNo: m[1],
        partNumber: customer,
        mpn: m[3],
        quantity: normalizeQty(m[6]),
        description: '',
      };
    },
  },
  // A: Line# Schedule# Part#/Desc  CustomerPart#  Qty (EA) — Manufacturer Part # blank
  {
    re: /(\d{1,4})\s+(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{4,})\s+(\S+?)\s+(\d+(?:[.,]\d+)?)\s*\(\s*EA\s*\)/gi,
    map: function (m) {
      const poPartDesc = m[3];
      const maybeCustomer = m[4];
      if (!looksLikeSapPart(poPartDesc)) return null;
      const customer = looksLikeCustomerPart(maybeCustomer) ? maybeCustomer : '';
      if (!customer && /^\d+(?:[.,]\d+)?$/.test(maybeCustomer)) return null;
      return {
        lineNo: m[1],
        partNumber: customer,
        mpn: poPartDesc,
        quantity: normalizeQty(m[5]),
        description: '',
      };
    },
  },
  // D: Line# Schedule# Part#/Desc Qty (EA) — no Customer Part #
  // (P) empty fallback to Part # later; (1P)=Part #
  {
    re: /(\d{1,4})\s+(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{4,})\s+(\d+(?:[.,]\d+)?)\s*\(\s*EA\s*\)/gi,
    map: function (m) {
      if (!looksLikeSapPart(m[3])) return null;
      return {
        lineNo: m[1],
        partNumber: '',
        mpn: m[3],
        quantity: normalizeQty(m[4]),
        description: '',
      };
    },
  },
  // B: Line# Part#/Desc Qty (EA)
  {
    re: /(\d{1,4})\s+([A-Za-z][A-Za-z0-9]{4,})\s+(\d+(?:[.,]\d+)?)\s*\(\s*EA\s*\)/gi,
    map: function (m) {
      if (!looksLikeSapPart(m[2])) return null;
      return {
        lineNo: m[1],
        partNumber: '',
        mpn: m[2],
        quantity: normalizeQty(m[3]),
        description: '',
      };
    },
  },
  // C: Line# Schedule# digit-only token Qty (EA) — treat as (1P); (P) blank
  {
    re: /(\d{1,4})\s+(\d{1,3})\s+(\d{8,})\s+(\d+(?:[.,]\d+)?)\s*\(\s*EA\s*\)/g,
    map: function (m) {
      return {
        lineNo: m[1],
        partNumber: '',
        mpn: m[3],
        quantity: normalizeQty(m[4]),
        description: '',
      };
    },
  },
];

/**
 * @param {string} flat
 * @returns {PoLine[]}
 */
function scanItemsGlobal(flat) {
  /** @type {PoLine[]} */
  const found = [];
  /** @type {Record<string, boolean>} */
  const seen = Object.create(null);

  for (let p = 0; p < ITEM_PATTERNS.length; p++) {
    const spec = ITEM_PATTERNS[p];
    spec.re.lastIndex = 0;
    let m;
    while ((m = spec.re.exec(flat)) !== null) {
      const hit = spec.map(m);
      if (!hit || !hit.quantity) continue;
      const pVal = hit.partNumber || '';
      const oneP = hit.mpn || '';
      if (!pVal && !oneP) continue;
      const key = hit.lineNo + '|' + pVal + '|' + oneP + '|' + hit.quantity;
      if (seen[key]) continue;
      seen[key] = true;
      found.push({
        lineNo: hit.lineNo,
        partNumber: pVal,
        mpn: oneP,
        quantity: hit.quantity,
        description: '',
      });
    }
  }

  // Stable order by line number then (P)/(1P)
  found.sort(function (a, b) {
    const na = Number(a.lineNo) || 0;
    const nb = Number(b.lineNo) || 0;
    if (na !== nb) return na - nb;
    const ka = a.partNumber || a.mpn;
    const kb = b.partNumber || b.mpn;
    return ka.localeCompare(kb);
  });
  return found;
}

/**
 * Try to parse one line-item from a text window (line-oriented fallback).
 * @param {string} window
 * @returns {PoLine|null}
 */
function matchLineItem(window) {
  const hits = scanItemsGlobal(window);
  return hits.length ? hits[0] : null;
}

/**
 * Pull a short description line following an item row.
 * @param {string[]} lines
 * @param {number} afterIndex
 * @returns {string}
 */
function peekDescription(lines, afterIndex) {
  for (let i = afterIndex; i < Math.min(lines.length, afterIndex + 4); i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (/^(STATUS|상태|Other Information|기타 정보|Schedule|일정)/i.test(raw)) break;
    if (/^\d+\s+\d+\s+/.test(raw) && /\(\s*EA\s*\)/i.test(raw)) break;
    if (/^\(?\s*EA\s*\)?$/i.test(raw)) continue;
    if (/^\d+(?:[.,]\d+)?\s*\(\s*EA\s*\)/i.test(raw)) continue;
    if (/^\$/.test(raw)) continue;
    if (raw.length >= 3 && raw.length <= 120 && !/Purchase|구매|Micron Technology/i.test(raw)) {
      return raw.replace(/\s+/g, ' ');
    }
  }
  return '';
}

/**
 * Parse full PO text into structured fields.
 * @param {string} text
 * @returns {ParsedPo}
 */
export function parsePoText(text) {
  const t = normalizePoText(text);
  /** @type {string[]} */
  const warnings = [];
  const language = detectPoLanguage(t);
  const po = extractPoNumber(t);
  if (!po) warnings.push('Could not find PO number.');

  // Flatten for global scan (PDF.js may not preserve table row breaks)
  const flat = t.replace(/\s+/g, ' ').trim();
  let items = scanItemsGlobal(flat);

  // Enrich descriptions from line-oriented view when available
  const lines = t.split(/\n/);
  if (items.length) {
    for (let i = 0; i < items.length; i++) {
      const token = items[i].partNumber || items[i].mpn;
      for (let li = 0; li < lines.length; li++) {
        if (token && lines[li].indexOf(token) !== -1) {
          const desc = peekDescription(lines, li + 1);
          if (desc) items[i].description = desc;
          break;
        }
      }
    }
  } else {
    // Line-window fallback (pypdf-style multi-line rows)
    /** @type {Record<string, boolean>} */
    const seen = Object.create(null);
    items = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (
        /Line\s*#|라인\s*번호|Manufacturer\s*Part|품목\s*번호/i.test(trimmed) &&
        !/\(\s*EA\s*\)/i.test(trimmed)
      ) {
        continue;
      }
      let hit = null;
      let consumed = 1;
      for (let w = 1; w <= 4 && !hit; w++) {
        const window = windowText(lines, i, w);
        if (!/\(\s*EA\s*\)/i.test(window)) continue;
        hit = matchLineItem(window);
        if (hit) consumed = w;
      }
      if (!hit || !hit.quantity) continue;
      const pVal = hit.partNumber || '';
      const oneP = hit.mpn || '';
      if (!pVal && !oneP) continue;
      const key = hit.lineNo + '|' + pVal + '|' + oneP + '|' + hit.quantity;
      if (seen[key]) continue;
      seen[key] = true;
      items.push({
        lineNo: hit.lineNo,
        partNumber: pVal,
        mpn: oneP,
        quantity: hit.quantity,
        description: peekDescription(lines, i + consumed),
      });
    }
  }

  if (!items.length) {
    warnings.push('No line items with quantity (EA) were found.');
  }

  return { po: po, language: language, lines: items, warnings: warnings };
}

/**
 * Map a parsed PO onto shipment fields (packing slip + per-part packages).
 * Does not invent packing slip / invoice / lot / serial / dates.
 *
 * @param {ParsedPo} parsed
 * @param {import('./shipment.js').Shipment} [base]
 * @returns {{ shipment: import('./shipment.js').Shipment, warnings: string[] }}
 */
export function applyParsedPoToShipment(parsed, base) {
  const warnings = (parsed.warnings || []).slice();
  const prev = base || emptyShipment();

  /** @type {import('./validators.js').PartLine[]} */
  const partLines = [];
  const mpns = [];

  for (let i = 0; i < parsed.lines.length; i++) {
    const line = parsed.lines[i];
    // (P) ← Customer Part #; (1P) ← Part # / Description
    // If Customer Part # missing, fall back so the row still appears on the part list.
    const pField = line.partNumber || line.mpn || '';
    const oneP = line.mpn || '';
    if (!pField && !oneP) continue;
    partLines.push({
      partNumber: pField,
      quantity: line.quantity,
    });
    mpns.push(oneP);
  }

  if (!partLines.length) {
    warnings.push('PO produced no part lines — form was not changed.');
    return { shipment: prev, warnings: warnings };
  }

  let total = 0;
  for (let i = 0; i < partLines.length; i++) {
    total += Number(partLines[i].quantity) || 0;
  }

  const firstMpn =
    mpns.find(function (m) {
      return !!m;
    }) || '';

  // [Assumption] Vendor on these POs is ATI; (21P) Manufacturer defaults to ATI for hardware.
  const manufacturer = prev.manufacturer || 'ATI';

  /** @type {import('./shipment.js').Shipment} */
  const next = Object.assign(emptyShipment(), {
    material: prev.material,
    dateMode: prev.dateMode,
    po: parsed.po || prev.po,
    packingSlip: prev.packingSlip,
    invoice: prev.invoice,
    mpnDefault: firstMpn || prev.mpnDefault,
    manufacturer: manufacturer,
    origin: prev.origin,
    totalQuantity: total > 0 ? String(total) : '',
    includeExpiryOnSlip: prev.includeExpiryOnSlip,
    slipExpiry: prev.slipExpiry,
    partLines: partLines,
    packages: [],
  });

  next.packages = syncPackagesFromPartList(partLines, prev.packages || [], next);
  for (let i = 0; i < next.packages.length; i++) {
    if (mpns[i]) {
      next.packages[i].mpn = mpns[i];
    }
    if (!next.packages[i].manufacturer) {
      next.packages[i].manufacturer = manufacturer;
    }
  }

  if (!parsed.po) warnings.push('PO number missing — check the PDF.');
  warnings.push(
    'Filled PO, (P) from Customer Part #, (1P) from Part # / Description. Enter packing slip, invoice, lot, serial, and dates manually.'
  );

  return { shipment: next, warnings: warnings };
}
