import JSZip from 'jszip';
import type { ExportTable } from './table';

/**
 * One workbook, one sheet per tracker. Pictures are drawings anchored to the
 * cell — the form Excel, Numbers and Google Sheets all open.
 */

const PX = 9525; // EMU per CSS pixel
const IMG_H = 68;

const xmlEscape = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );

function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetName(label: string, used: Set<string>): string {
  const base = (label.replace(/[\\/*?:[\]]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function imageSize(bytes: Uint8Array, type: string): { w: number; h: number } {
  try {
    if (type.includes('png') && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const w = view.getUint32(16);
      const h = view.getUint32(20);
      if (w > 0 && h > 0) return { w, h };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1];
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (marker >= 0xc0 && marker <= 0xc3) {
          const h = (bytes[i + 5] << 8) | bytes[i + 6];
          const w = (bytes[i + 7] << 8) | bytes[i + 8];
          if (w > 0 && h > 0) return { w, h };
        }
        if (len < 2) break;
        i += 2 + len;
      }
    }
  } catch {
    /* fall through */
  }
  return { w: 16, h: 9 };
}

interface Placed {
  row: number;
  col: number;
  media: string;
  cx: number;
  cy: number;
}

export async function buildXlsx(tables: ExportTable[], getBlob: (key: string) => Promise<Blob | undefined>): Promise<Uint8Array> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const media = new Map<string, { path: string; ext: string }>();
  let mediaN = 0;
  const sheets: { name: string; file: string; drawing?: string }[] = [];

  for (let s = 0; s < tables.length; s++) {
    const table = tables[s];
    const name = sheetName(table.category.label, usedNames);
    const file = `xl/worksheets/sheet${s + 1}.xml`;
    const placed: Placed[] = [];
    const cols = table.columns
      .map((c, i) => {
        const px = c.isImage ? 160 : Math.min(280, Math.max(64, Math.round(c.width * 88)));
        const width = Math.round(((px - 5) / 7) * 100) / 100;
        return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
      })
      .join('');

    const header = table.columns
      .map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEscape(c.label)}</t></is></c>`)
      .join('');
    const rows = [`<row r="1">${header}</row>`];

    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r];
      let tall = false;
      let lines = 1;
      const cells: string[] = [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const image = cell.images?.[0];
        let text = cell.images?.length ? '' : cell.text;
        if (image) {
          const blob = await getBlob(image.key);
          if (blob && blob.type !== 'application/pdf') {
            const bytes = await blobBytes(blob);
            let slot = media.get(image.key);
            if (!slot) {
              const ext = blob.type.includes('png') ? 'png' : 'jpeg';
              slot = { path: `xl/media/image${++mediaN}.${ext}`, ext };
              media.set(image.key, slot);
              zip.file(slot.path, bytes);
            }
            const size = imageSize(bytes, blob.type);
            const pxW = Math.min(148, Math.max(24, Math.round(IMG_H * (size.w / size.h))));
            placed.push({ row: r + 1, col: c, media: slot.path, cx: pxW * PX, cy: IMG_H * PX });
            tall = true;
            if ((cell.images?.length ?? 0) > 1) text = `+${cell.images!.length - 1}`;
          }
        }
        if (!text) continue;
        lines = Math.max(lines, text.split('\n').length);
        const space = /[\n\r]/.test(text) || /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
        cells.push(`<c r="${colName(c)}${r + 2}" t="inlineStr" s="0"><is><t${space}>${xmlEscape(text)}</t></is></c>`);
      }
      const ht = tall ? ` ht="62" customHeight="1"` : lines > 1 ? ` ht="${Math.min(15 * lines + 8, 90)}" customHeight="1"` : '';
      rows.push(`<row r="${r + 2}"${ht}>${cells.join('')}</row>`);
    }

    if (table.removed.length) {
      const at = table.rows.length + 3;
      rows.push(`<row r="${at}"><c r="A${at}" t="inlineStr" s="1"><is><t>${xmlEscape(`Removed (${table.removed.length})`)}</t></is></c></row>`);
      table.removed.forEach((removed, i) => {
        const rr = at + 1 + i;
        const cells = removed
          .map((text, c) => `<c r="${colName(c)}${rr}" t="inlineStr" s="0"><is><t>${xmlEscape(text)}</t></is></c>`)
          .join('');
        rows.push(`<row r="${rr}">${cells}</row>`);
      });
    }

    const lastRow = table.rows.length + 2 + (table.removed.length ? table.removed.length + 2 : 0);
    const lastCol = colName(Math.max(0, table.columns.length - 1));
    const drawing = placed.length ? `  <drawing r:id="rId1"/>\n` : '';
    zip.file(
      file,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCol}${Math.max(1, lastRow)}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <cols>${cols}</cols>
  <sheetData>
    ${rows.join('\n    ')}
  </sheetData>
${drawing}</worksheet>`,
    );

    let drawingFile: string | undefined;
    if (placed.length) {
      drawingFile = `xl/drawings/drawing${s + 1}.xml`;
      const rels = placed
        .map((p, i) => {
          const target = p.media.replace(/^xl\//, '../');
          return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
        })
        .join('');
      const anchors = placed
        .map((p, i) => {
          return `<xdr:oneCellAnchor>
      <xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>${4 * PX}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${4 * PX}</xdr:rowOff></xdr:from>
      <xdr:ext cx="${p.cx}" cy="${p.cy}"/>
      <xdr:pic>
        <xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
        <xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
        <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.cx}" cy="${p.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
      </xdr:pic>
      <xdr:clientData/>
    </xdr:oneCellAnchor>`;
        })
        .join('\n    ');
      zip.file(
        drawingFile,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    ${anchors}
</xdr:wsDr>`,
      );
      zip.file(`xl/drawings/_rels/drawing${s + 1}.xml.rels`, relsXml(rels));
      zip.file(
        `xl/worksheets/_rels/sheet${s + 1}.xml.rels`,
        relsXml(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${s + 1}.xml"/>`),
      );
    }
    sheets.push({ name, file, drawing: drawingFile });
  }

  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    ...sheets.map(
      (s) =>
        `<Override PartName="/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
    ...sheets
      .filter((s) => s.drawing)
      .map(
        (s) =>
          `<Override PartName="/${s.drawing}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      ),
  ];
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png" ContentType="image/png"/>
  ${overrides.join('\n  ')}
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    relsXml(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`),
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n    ')}
  </sheets>
</workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    relsXml(
      [
        ...sheets.map(
          (s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${s.file.slice(3)}"/>`,
        ),
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
      ].join(''),
    ),
  );
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`,
  );

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** jsdom's Blob has no arrayBuffer(); browsers and Node do. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

function relsXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
}
