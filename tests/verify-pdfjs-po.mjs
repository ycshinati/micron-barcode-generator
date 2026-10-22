import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePoText } from '../js/parse-po.js';

async function extract(path) {
  const data = new Uint8Array(readFileSync(path));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  let all = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    const buf = [];
    const lines = [];
    for (const item of content.items) {
      if (!item || typeof item.str !== 'string') continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
        if (buf.length) {
          lines.push(buf.join(' ').replace(/\s+/g, ' ').trim());
          buf.length = 0;
        }
      }
      if (item.str) buf.push(item.str);
      if (y != null) lastY = y;
    }
    if (buf.length) lines.push(buf.join(' ').replace(/\s+/g, ' ').trim());
    all += lines.join('\n') + '\n\n';
  }
  return all;
}

const paths = [
  [
    'MSB',
    'd:/ATI DRIVE/MICRON 2026/MSB (SINGAPORE)/260911 MICRON(MSB) PO4517190278 LMS SENSOR/4517190278.pdf',
  ],
  [
    'MTB',
    'd:/ATI DRIVE/MICRON 2026/MTB (TAIWAN)/260911 MICRON(MTB) PO3501631116 LMS SPARE PARTS/3501631116.pdf',
  ],
  [
    'KO',
    'd:/ATI DRIVE/MICRON 2026/MTB (TAIWAN)/261020 MICRON(MTB F16N) SUN2 #1 (EQ26B2607)/PO4516739305_Tongluo.pdf',
  ],
];

for (const [name, p] of paths) {
  const text = await extract(p);
  const parsed = parsePoText(text);
  console.log(name, 'po=', parsed.po, 'n=', parsed.lines.length);
  for (const l of parsed.lines) {
    console.log(' ', l.lineNo, l.partNumber, l.mpn, l.quantity, l.description);
  }
}
