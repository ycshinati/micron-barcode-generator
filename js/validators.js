/**
 * Field validators for Micron labels & packing slip (BEPRO).
 */

/**
 * @typedef {Object} FieldResult
 * @property {boolean} ok
 * @property {string} [message]
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function trim(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {FieldResult}
 */
export function required(value, label) {
  if (!trim(value)) {
    return { ok: false, message: `${label} is required.` };
  }
  return { ok: true };
}

/**
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateMpn(value) {
  const v = trim(value);
  const base = required(v, 'Manufacturer Part Number');
  if (!base.ok) return base;
  if (/\s/.test(v)) {
    return { ok: false, message: 'Manufacturer Part Number cannot contain spaces.' };
  }
  return { ok: true };
}

/**
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateLot(value) {
  const v = trim(value);
  if (!v) return { ok: true }; // optional
  if (v.length > 10) {
    return { ok: false, message: 'Lot Number cannot be longer than 10 characters.' };
  }
  return { ok: true };
}

/**
 * Date code YYYYMMDD — optional; when present must be YYYYMMDD.
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateDateCode(value) {
  const v = trim(value);
  if (!v) return { ok: true }; // optional
  if (!/^\d{8}$/.test(v)) {
    return { ok: false, message: 'Date Code must be YYYYMMDD (8 digits).' };
  }
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(4, 6));
  const d = Number(v.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) {
    return { ok: false, message: 'Date Code is not a valid calendar date.' };
  }
  return { ok: true };
}

/**
 * Expiry MM-DD-YYYY (labels / COC) — optional; when present must match format.
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateExpiry(value) {
  const v = trim(value);
  if (!v) return { ok: true }; // optional (same policy as date code)
  if (!/^\d{2}-\d{2}-\d{4}$/.test(v)) {
    return { ok: false, message: 'Expiry Date must be MM-DD-YYYY.' };
  }
  const parts = v.split('-').map(Number);
  const m = parts[0];
  const d = parts[1];
  const y = parts[2];
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) {
    return { ok: false, message: 'Expiry Date is not a valid calendar date.' };
  }
  return { ok: true };
}

/**
 * Packing slip expiry MM/DD/YYYY (§2.3.3.1)
 * @param {string} value
 * @param {boolean} requiredFlag
 * @returns {FieldResult}
 */
export function validatePackingSlipExpiry(value, requiredFlag) {
  const v = trim(value);
  if (!v) {
    if (requiredFlag) {
      return { ok: false, message: 'Expiry Date is required when enabled.' };
    }
    return { ok: true };
  }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    return { ok: false, message: 'Packing Slip Expiry must be MM/DD/YYYY.' };
  }
  const parts = v.split('/').map(Number);
  const m = parts[0];
  const d = parts[1];
  const y = parts[2];
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) {
    return { ok: false, message: 'Expiry Date is not a valid calendar date.' };
  }
  return { ok: true };
}

/**
 * Quantity digits only (UOM +EA applied at encode time for labels)
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateQuantity(value) {
  const v = trim(value);
  const base = required(v, 'Quantity');
  if (!base.ok) return base;
  const cleaned = v.replace(/\+EA$/i, '');
  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, message: 'Quantity must be a whole number (EA is added automatically).' };
  }
  return { ok: true };
}

/**
 * Serial: max 20; allowed specials -_:.# ; must not start with S
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateSerial(value) {
  const v = trim(value);
  if (!v) return { ok: true }; // optional
  if (v.length > 20) {
    return { ok: false, message: 'Serial Number cannot be longer than 20 characters.' };
  }
  if (/^S/i.test(v)) {
    return {
      ok: false,
      message: 'Serial Number must not start with S (avoids double-S after DI).',
    };
  }
  if (!/^[A-Za-z0-9\-_:.#]+$/.test(v)) {
    return {
      ok: false,
      message: 'Serial Number allows letters, digits, and - _ : . # only.',
    };
  }
  return { ok: true };
}

/** Allowed MSL values per §1.1.5.1 */
const MSL_VALUES = ['1', '2', '2A', '3', '4', '5', '5A', '6'];

/**
 * @param {string} value
 * @returns {FieldResult}
 */
export function validateMsl(value) {
  const v = trim(value).toUpperCase();
  const base = required(v, 'Moisture Sensitivity Level');
  if (!base.ok) return base;
  if (MSL_VALUES.indexOf(v) === -1) {
    return {
      ok: false,
      message: 'MSL must be one of: 1, 2, 2A, 3, 4, 5, 5A, 6.',
    };
  }
  return { ok: true };
}

/**
 * @typedef {Object} PartLine
 * @property {string} partNumber
 * @property {string} quantity
 */

/**
 * @typedef {Object} LabelFields
 * @property {'label'|'packing-slip'} document
 * @property {'hardware'|'component'} material
 * @property {'outer'|'inner'} packaging
 * @property {'9D'|'2D'} dateMode
 * @property {string} po
 * @property {string} packingSlip
 * @property {string} partNumber
 * @property {string} mpn
 * @property {string} manufacturer
 * @property {string} origin
 * @property {string} lot
 * @property {string} dateCode
 * @property {string} expiry
 * @property {string} quantity
 * @property {string} serial
 * @property {string} msl
 * @property {string} invoice
 * @property {boolean} includeExpiryOnSlip
 * @property {string} slipExpiry
 * @property {PartLine[]} partLines
 */

/**
 * Legacy helper: treat template outer/inner as packaging.
 * @param {LabelFields} fields
 * @returns {'outer'|'inner'|null}
 */
export function packagingOf(fields) {
  if (fields.document === 'packing-slip') return null;
  return fields.packaging;
}

/**
 * @param {LabelFields} fields
 * @returns {{ ok: boolean, errors: Record<string, string> }}
 */
export function validateAll(fields) {
  /** @type {Record<string, string>} */
  const errors = {};

  /**
   * @param {string} key
   * @param {FieldResult} result
   */
  function apply(key, result) {
    if (!result.ok && result.message) {
      errors[key] = result.message;
    }
  }

  if (fields.document === 'packing-slip') {
    apply('packingSlip', required(fields.packingSlip, 'Packing Slip Number'));
    apply('invoice', required(fields.invoice, 'Invoice Number'));
    apply('po', required(fields.po, 'PO Number'));
    // Header MPN is optional when part list drives the slip; keep soft check if provided
    if (trim(fields.mpn)) {
      apply('mpn', validateMpn(fields.mpn));
    }
    if (trim(fields.quantity)) {
      apply('quantity', validateQuantity(fields.quantity));
    }
    apply(
      'slipExpiry',
      validatePackingSlipExpiry(fields.slipExpiry, !!fields.includeExpiryOnSlip)
    );

    const lines = fields.partLines || [];
    const usable = lines.filter(function (l) {
      return trim(l.partNumber) || trim(l.quantity);
    });
    if (usable.length === 0) {
      errors.partLines = 'Add at least one part (part number + quantity).';
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (!trim(lines[i].partNumber) && !trim(lines[i].quantity)) continue;
        const pnResult = required(lines[i].partNumber, 'Part Number');
        const qtyResult = validateQuantity(lines[i].quantity);
        if (!pnResult.ok) {
          errors['partLine_' + i + '_part'] = pnResult.message || 'Invalid part number.';
        }
        if (!qtyResult.ok) {
          errors['partLine_' + i + '_qty'] = qtyResult.message || 'Invalid quantity.';
        }
      }
    }

    return { ok: Object.keys(errors).length === 0, errors };
  }

  // Label (Hardware or Component Reels)
  if (fields.packaging === 'outer') {
    apply('po', required(fields.po, 'PO Number'));
    apply('packingSlip', required(fields.packingSlip, 'Packing Slip'));
  }

  apply('partNumber', required(fields.partNumber, 'Part Number'));
  apply('mpn', validateMpn(fields.mpn));
  apply('manufacturer', required(fields.manufacturer, 'Manufacturer'));
  apply('origin', required(fields.origin, 'Origin'));
  apply('lot', validateLot(fields.lot));

  if (fields.dateMode === '2D') {
    apply('expiry', validateExpiry(fields.expiry));
  } else {
    apply('dateCode', validateDateCode(fields.dateCode));
  }

  apply('quantity', validateQuantity(fields.quantity));
  apply('serial', validateSerial(fields.serial));

  // Component reel inner requires MSL (7E) in 2D / HR (§3.4.2 Table 11)
  if (fields.material === 'component' && fields.packaging === 'inner') {
    apply('msl', validateMsl(fields.msl));
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
  };
}
