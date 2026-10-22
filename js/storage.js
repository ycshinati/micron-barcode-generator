/**
 * Persist label / packing-slip form data (localStorage + JSON file).
 */

export const STORAGE_KEY = 'micron-barcode-generator:v1';
export const STORAGE_FORMAT = 'micron-barcode-generator';
export const STORAGE_VERSION = 1;

/**
 * @typedef {import('./validators.js').LabelFields} LabelFields
 */

/**
 * @typedef {Object} SavedPayload
 * @property {string} format
 * @property {number} version
 * @property {string} savedAt ISO timestamp
 * @property {LabelFields} fields
 */

/**
 * Normalize unknown JSON into LabelFields with safe defaults.
 * @param {unknown} raw
 * @returns {LabelFields|null}
 */
export function normalizeFields(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);

  const docRaw = o.document;
  const document =
    docRaw === 'packing-slip' || docRaw === 'label' || docRaw === 'shipment'
      ? docRaw
      : 'label';
  const material = o.material === 'component' || o.material === 'hardware' ? o.material : 'hardware';
  const packaging = o.packaging === 'inner' || o.packaging === 'outer' ? o.packaging : 'outer';
  const dateMode = o.dateMode === '2D' || o.dateMode === '9D' ? o.dateMode : '9D';

  /** @type {import('./validators.js').PartLine[]} */
  let partLines = [{ partNumber: '', quantity: '' }];
  const rawLines = Array.isArray(o.partLines)
    ? o.partLines
    : Array.isArray(o.lotLines)
      ? o.lotLines
      : null;
  if (rawLines && rawLines.length > 0) {
    partLines = rawLines.map(function (line) {
      const L = line && typeof line === 'object' ? /** @type {Record<string, unknown>} */ (line) : {};
      return {
        partNumber: str(L.partNumber || L.lot),
        quantity: str(L.quantity),
      };
    });
  }

  /** @type {Record<string, unknown>} */
  const result = {
    document: document,
    material: material,
    packaging: packaging,
    dateMode: dateMode,
    po: str(o.po),
    packingSlip: str(o.packingSlip),
    partNumber: str(o.partNumber),
    mpn: str(o.mpn),
    manufacturer: str(o.manufacturer),
    origin: str(o.origin),
    lot: str(o.lot),
    dateCode: str(o.dateCode),
    expiry: str(o.expiry),
    quantity: str(o.quantity),
    serial: str(o.serial),
    msl: str(o.msl) || '3',
    invoice: str(o.invoice),
    includeExpiryOnSlip: !!o.includeExpiryOnSlip,
    slipExpiry: str(o.slipExpiry),
    partLines: partLines,
  };

  if (o.shipment && typeof o.shipment === 'object') {
    result.shipment = o.shipment;
  }

  return /** @type {import('./validators.js').LabelFields} */ (result);
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  return v == null ? '' : String(v);
}

/**
 * @param {LabelFields} fields
 * @param {string} [savedAt]
 * @returns {SavedPayload}
 */
export function buildSavedPayload(fields, savedAt) {
  return {
    format: STORAGE_FORMAT,
    version: STORAGE_VERSION,
    savedAt: savedAt || new Date().toISOString(),
    fields: fields,
  };
}

/**
 * @param {string} jsonText
 * @returns {{ ok: true, payload: SavedPayload } | { ok: false, message: string }}
 */
export function parseSavedJson(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, message: 'File is not valid JSON.' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, message: 'Invalid save file.' };
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  // Accept either wrapped payload or bare fields object
  const fieldsRaw =
    obj.format === STORAGE_FORMAT && obj.fields ? obj.fields : obj.po !== undefined || obj.document ? obj : null;

  if (!fieldsRaw) {
    return { ok: false, message: 'Unrecognized save file format.' };
  }

  const fields = normalizeFields(fieldsRaw);
  if (!fields) {
    return { ok: false, message: 'Could not read fields from save file.' };
  }

  return {
    ok: true,
    payload: {
      format: STORAGE_FORMAT,
      version: typeof obj.version === 'number' ? obj.version : STORAGE_VERSION,
      savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString(),
      fields: fields,
    },
  };
}

/**
 * @param {Storage|null|undefined} storage
 * @param {LabelFields} fields
 * @returns {{ ok: boolean, savedAt?: string, message?: string }}
 */
export function saveToLocalStorage(storage, fields) {
  if (!storage) {
    return { ok: false, message: 'Local storage is not available.' };
  }
  try {
    const payload = buildSavedPayload(fields);
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true, savedAt: payload.savedAt };
  } catch (err) {
    return {
      ok: false,
      message: err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : 'Save failed.',
    };
  }
}

/**
 * @param {Storage|null|undefined} storage
 * @returns {{ ok: true, payload: SavedPayload } | { ok: false, message: string }}
 */
export function loadFromLocalStorage(storage) {
  if (!storage) {
    return { ok: false, message: 'Local storage is not available.' };
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ok: false, message: 'No saved data found.' };
    }
    return parseSavedJson(raw);
  } catch (err) {
    return { ok: false, message: 'Could not read saved data.' };
  }
}

/**
 * @param {LabelFields} fields
 * @returns {string}
 */
export function toDownloadFilename(fields) {
  const doc = fields.document === 'packing-slip' ? 'packing-slip' : fields.material + '-' + fields.packaging;
  const part = (fields.partNumber || 'label').replace(/[^\w.-]+/g, '_');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return 'micron-' + doc + '-' + part + '-' + stamp + '.json';
}
