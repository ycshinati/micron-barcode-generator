/**
 * Extract text from a Micron PO PDF in the browser via pdf.js (CDN ESM).
 * Evidence: pdfjs-dist build/pdf.mjs + pdf.worker.mjs (Mozilla PDF.js).
 */

const PDFJS_VERSION = '4.10.38';
const PDFJS_PDF = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/build/pdf.mjs';
const PDFJS_WORKER =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/build/pdf.worker.mjs';

/** @type {any} */
let pdfjsLib = null;

/**
 * @returns {Promise<any>}
 */
async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_PDF);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

/**
 * @param {ArrayBuffer} data
 * @returns {Promise<string>}
 */
export async function extractTextFromPdf(data) {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: data });
  const pdf = await loadingTask.promise;
  /** @type {string[]} */
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(function (item) {
      return item && typeof item.str === 'string' ? item.str : '';
    });
    pages.push(strings.join(' '));
  }
  // Join with newlines so the line-oriented PO parser can find item rows.
  // PDF.js often emits reading-order fragments separated by spaces; also keep
  // a second pass with original spacing by reconstructing via transform Y breaks.
  return pages.join('\n');
}

/**
 * Richer extraction: insert newlines when Y position jumps (table rows).
 * @param {ArrayBuffer} data
 * @returns {Promise<string>}
 */
export async function extractTextFromPdfStructured(data) {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: data });
  const pdf = await loadingTask.promise;
  /** @type {string[]} */
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    /** @type {string[]} */
    const lines = [];
    let lastY = null;
    /** @type {string[]} */
    let buf = [];

    for (let i = 0; i < content.items.length; i++) {
      const item = content.items[i];
      if (!item || typeof item.str !== 'string') continue;
      const tr = item.transform;
      const y = tr && tr.length >= 6 ? Math.round(tr[5]) : null;
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
        if (buf.length) {
          lines.push(buf.join(' ').replace(/\s+/g, ' ').trim());
          buf = [];
        }
      }
      if (item.str) buf.push(item.str);
      if (y != null) lastY = y;
    }
    if (buf.length) {
      lines.push(buf.join(' ').replace(/\s+/g, ' ').trim());
    }
    pages.push(lines.join('\n'));
  }

  return pages.join('\n\n');
}
