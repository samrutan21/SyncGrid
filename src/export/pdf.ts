import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { store } from '../storage/store';
import type { ExportTable } from './table';

/**
 * PDF export (pdf-lib, generated fully in the browser). Tabloid landscape so
 * wide trackers (archival has ~16 columns) stay readable; screenshots and
 * evidence images are embedded in their cells.
 */

const PAGE_W = 1224; // 17in
const PAGE_H = 792; // 11in
const M = 32;
const FONT_SIZE = 7.5;
const LINE_H = 9.4;
const PAD = 4;
const IMG_MAX_H = 64;

const INK = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.42, 0.45, 0.5);
const HEAD_BG = rgb(0.13, 0.14, 0.17);
const ZEBRA = rgb(0.965, 0.968, 0.975);
const RULE = rgb(0.86, 0.87, 0.9);

export interface PdfMeta {
  project: string;
  episode: string;
  version: string;
}

export async function buildPDF(tables: ExportTable[], meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${meta.project} · ${meta.episode} · ${meta.version}`);
  doc.setProducer('SyncGrid');
  doc.setCreator('SyncGrid');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const images = new Map<string, PDFImage | null>();
  const clean = makeCleaner(font);

  const embed = async (key: string): Promise<PDFImage | null> => {
    if (images.has(key)) return images.get(key)!;
    let img: PDFImage | null = null;
    try {
      const blob = await store.getBlob(key);
      if (blob && blob.type !== 'application/pdf') {
        const bytes = await toJpegOrPng(blob);
        img = bytes.type === 'png' ? await doc.embedPng(bytes.data) : await doc.embedJpg(bytes.data);
      }
    } catch {
      img = null;
    }
    images.set(key, img);
    return img;
  };

  for (const t of tables) {
    const usable = PAGE_W - M * 2;
    const totalW = t.columns.reduce((s, c) => s + c.width, 0);
    const widths = t.columns.map((c) => (c.width / totalW) * usable);

    let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
    let y = drawPageHeader(page, t, meta, bold, font, clean);
    y = drawTableHeader(page, t, widths, y, bold, clean);

    for (let r = 0; r < t.rows.length; r++) {
      const row = t.rows[r];
      // Measure.
      const cellLines = row.map((c, i) => (c.images?.length ? [] : wrap(clean(c.text), font, FONT_SIZE, widths[i] - PAD * 2)));
      const imgs = await Promise.all(row.map(async (c) => (c.images?.length ? Promise.all(c.images.map((im) => embed(im.key))) : [])));
      let h = LINE_H + PAD * 2;
      row.forEach((c, i) => {
        if (c.images?.length) {
          const first = imgs[i].find(Boolean);
          if (first) {
            const w = widths[i] - PAD * 2;
            h = Math.max(h, Math.min(IMG_MAX_H, (first.height / first.width) * w) + PAD * 2 + (c.images.length > 1 ? LINE_H : 0));
          } else {
            h = Math.max(h, LINE_H * Math.min(3, c.images.length) + PAD * 2);
          }
        } else {
          h = Math.max(h, cellLines[i].length * LINE_H + PAD * 2);
        }
      });
      if (y - h < M + 14) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = drawPageHeader(page, t, meta, bold, font, clean, true);
        y = drawTableHeader(page, t, widths, y, bold, clean);
      }
      if (r % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: usable, height: h, color: ZEBRA });
      page.drawLine({ start: { x: M, y: y - h }, end: { x: M + usable, y: y - h }, thickness: 0.4, color: RULE });

      let x = M;
      row.forEach((c, i) => {
        const w = widths[i];
        if (c.images?.length) {
          const list = imgs[i];
          const first = list.find(Boolean);
          if (first) {
            const iw = w - PAD * 2;
            const ih = Math.min(IMG_MAX_H, (first.height / first.width) * iw);
            const sw = (first.width / first.height) * ih;
            page.drawImage(first, { x: x + PAD, y: y - PAD - ih, width: Math.min(iw, sw), height: ih });
            if (c.images.length > 1)
              page.drawText(clean(`+${c.images.length - 1} more`), { x: x + PAD, y: y - PAD - ih - LINE_H + 1.5, size: FONT_SIZE - 1, font, color: MUTED });
          } else {
            c.images.slice(0, 3).forEach((im, k) => {
              const label = truncate(clean(im.type === 'application/pdf' ? `PDF: ${im.name}` : im.name), font, FONT_SIZE, w - PAD * 2);
              page.drawText(label, { x: x + PAD, y: y - PAD - LINE_H * (k + 1) + 2, size: FONT_SIZE, font, color: MUTED });
            });
          }
        } else {
          cellLines[i].forEach((ln, k) => {
            page.drawText(ln, { x: x + PAD, y: y - PAD - LINE_H * (k + 1) + 2, size: FONT_SIZE, font: i === 0 ? bold : font, color: INK });
          });
        }
        x += w;
      });
      y -= h;
    }

    if (t.removed.length) {
      const need = 30 + t.removed.length * LINE_H;
      if (y - Math.min(need, 80) < M + 14) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = drawPageHeader(page, t, meta, bold, font, clean, true);
      }
      y -= 18;
      page.drawText(clean(`Removed since baseline (${t.removed.length})`), { x: M, y, size: 10, font: bold, color: INK });
      y -= 6;
      for (const r of t.removed) {
        if (y - LINE_H < M + 14) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = drawPageHeader(page, t, meta, bold, font, clean, true);
        }
        y -= LINE_H + 2;
        page.drawText(clean(r.join('    ')), { x: M, y, size: FONT_SIZE + 0.5, font, color: INK });
      }
    }
  }

  // Footers.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const txt = `Page ${i + 1} of ${pages.length}`;
    p.drawText(txt, { x: PAGE_W - M - font.widthOfTextAtSize(txt, 7), y: M - 14, size: 7, font, color: MUTED });
    p.drawText(clean(`${meta.project} · ${meta.episode} · ${meta.version}`), { x: M, y: M - 14, size: 7, font, color: MUTED });
  });
  return doc.save();
}

function drawPageHeader(
  page: PDFPage,
  t: ExportTable,
  meta: PdfMeta,
  bold: PDFFont,
  font: PDFFont,
  clean: (s: string) => string,
  cont = false,
): number {
  let y = PAGE_H - M;
  const title = `${t.category.label}${cont ? ' (continued)' : ''}`;
  page.drawRectangle({ x: M, y: y - 16, width: 4, height: 16, color: hexToRgb(t.category.color) });
  page.drawText(clean(title), { x: M + 10, y: y - 13, size: 15, font: bold, color: INK });
  const right = clean(`${meta.project}  ·  ${meta.episode}  ·  ${meta.version}  ·  ${new Date().toLocaleDateString()}`);
  page.drawText(right, { x: PAGE_W - M - font.widthOfTextAtSize(right, 9), y: y - 12, size: 9, font, color: MUTED });
  y -= 22;
  const sub = [`${t.rows.length} entries`, t.summary].filter(Boolean).join('   ·   ');
  page.drawText(clean(sub), { x: M + 10, y: y - 8, size: 8.5, font, color: MUTED });
  return y - 18;
}

function drawTableHeader(page: PDFPage, t: ExportTable, widths: number[], y: number, bold: PDFFont, clean: (s: string) => string): number {
  const lines = t.columns.map((c, i) => wrap(clean(c.label.toUpperCase()), bold, FONT_SIZE - 0.5, widths[i] - PAD * 2));
  const h = Math.max(...lines.map((l) => l.length)) * LINE_H + PAD * 2;
  page.drawRectangle({ x: M, y: y - h, width: widths.reduce((a, b) => a + b, 0), height: h, color: HEAD_BG });
  let x = M;
  lines.forEach((ls, i) => {
    ls.forEach((ln, k) => page.drawText(ln, { x: x + PAD, y: y - PAD - LINE_H * (k + 1) + 2, size: FONT_SIZE - 0.5, font: bold, color: rgb(1, 1, 1) }));
    x += widths[i];
  });
  return y - h;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line);
      // Break very long words (file names) by character.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        // Prefer breaking after _ - . so file names split at readable points.
        const soft = Math.max(w.lastIndexOf('_', n - 1), w.lastIndexOf('-', n - 1), w.lastIndexOf('.', n - 1));
        if (soft > n * 0.45) n = soft + 1;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out.slice(0, 14);
}

function truncate(s: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let n = s.length;
  while (n > 1 && font.widthOfTextAtSize(`${s.slice(0, n)}…`, size) > width) n--;
  return `${s.slice(0, n)}…`;
}

/** Standard PDF fonts only cover WinAnsi: swap or drop anything they can't draw. */
function makeCleaner(font: PDFFont) {
  const ok = new Map<string, boolean>();
  const swaps: Record<string, string> = { '−': '-', '–': '-', '—': '-', '→': '->', ' ': ' ', '�': '?' };
  return (s: string) =>
    Array.from(s.normalize('NFC'))
      .map((ch) => {
        if (swaps[ch]) return swaps[ch];
        let good = ok.get(ch);
        if (good === undefined) {
          try {
            font.encodeText(ch);
            font.widthOfTextAtSize(ch, 8);
            good = true;
          } catch {
            good = false;
          }
          ok.set(ch, good);
        }
        if (good) return ch;
        const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
        return base && base !== ch ? base : '?';
      })
      .join('');
}

async function toJpegOrPng(blob: Blob): Promise<{ type: 'jpg' | 'png'; data: Uint8Array }> {
  if (/jpe?g/i.test(blob.type)) return { type: 'jpg', data: new Uint8Array(await blob.arrayBuffer()) };
  if (/png/i.test(blob.type)) return { type: 'png', data: new Uint8Array(await blob.arrayBuffer()) };
  // Other formats (webp, gif, heic where supported): re-encode through a canvas.
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
  if (!out) throw new Error('could not convert image');
  return { type: 'jpg', data: new Uint8Array(await out.arrayBuffer()) };
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return rgb(0.5, 0.5, 0.5);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}
