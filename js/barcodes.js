/**
 * Shared bwip-js canvas helpers.
 */

/**
 * Code 128 defaults: narrower modules (shorter symbol) with taller bars for scanability.
 * Payload length is fixed by Micron DI encoding; only geometry can shorten the print.
 * [Assumption] Target ~0.25 mm X-dim at typical 96 dpi CSS print mapping — verify with a scanner.
 */
export const CODE128_OPTS = {
  scaleX: 1,
  scaleY: 2,
  height: 7,
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} bcid
 * @param {string} text
 * @param {Record<string, unknown>} [extra]
 * @returns {boolean}
 */
export function drawBwip(canvas, bcid, text, extra) {
  if (!text || typeof window.bwipjs === 'undefined') {
    return false;
  }
  try {
    window.bwipjs.toCanvas(
      canvas,
      Object.assign(
        {
          bcid: bcid,
          text: text,
          scale: 2,
          includetext: false,
          paddingwidth: 0,
          paddingheight: 0,
          backgroundcolor: 'FFFFFF',
          barcolor: '000000',
        },
        extra || {}
      )
    );
    return true;
  } catch (err) {
    console.warn('Barcode render failed:', bcid, text, err);
    return false;
  }
}

/**
 * Draw a Micron 1D Code 128 barcode with compact geometry.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {Record<string, unknown>} [extra]
 * @returns {boolean}
 */
export function drawCode128(canvas, text, extra) {
  return drawBwip(canvas, 'code128', text, Object.assign({}, CODE128_OPTS, extra || {}));
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function clearCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvas.width = 1;
  canvas.height = 1;
}

/**
 * Deep-clone a node and preserve canvas bitmap data.
 * cloneNode() alone leaves canvases blank — critical for print.
 * @param {HTMLElement} source
 * @returns {HTMLElement}
 */
export function cloneWithCanvases(source) {
  const clone = /** @type {HTMLElement} */ (source.cloneNode(true));
  const srcCanvases = source.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  for (let i = 0; i < srcCanvases.length && i < dstCanvases.length; i++) {
    const src = srcCanvases[i];
    const dst = dstCanvases[i];
    if (src.width <= 1 || src.height <= 1) continue;
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d');
    if (ctx) {
      ctx.drawImage(src, 0, 0);
    }
  }
  return clone;
}

/**
 * Replace canvases with <img> so browsers print barcodes reliably.
 * @param {HTMLElement} root
 */
export function replaceCanvasesWithImages(root) {
  const canvases = root.querySelectorAll('canvas');
  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    if (canvas.width <= 1 || canvas.height <= 1) continue;
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      continue;
    }
    if (!dataUrl || dataUrl.length < 32) continue;

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '';
    img.className = canvas.className;
    // Let CSS (mm max-width) control print size — do not bake screen px into the image.
    img.style.imageRendering = 'pixelated';
    canvas.parentNode && canvas.parentNode.replaceChild(img, canvas);
  }
}
