/**
 * The GFX Text column stores a stack of lines in plain text so it still
 * exports, searches, and round-trips through IndexedDB as a string.
 * A leading ^ is a large line, a leading _ is a small line. Anything else
 * is normal. The markers are only a storage detail — the editor and the
 * exports show the words.
 */

export type LineSize = 'lg' | 'md' | 'sm';

export interface StackLine {
  size: LineSize;
  text: string;
}

export function parseStack(raw: string): StackLine[] {
  if (!raw) return [{ size: 'md', text: '' }];
  return raw.split(/\r?\n/).map((line) => {
    if (line.startsWith('^')) return { size: 'lg', text: line.slice(1) };
    if (line.startsWith('_')) return { size: 'sm', text: line.slice(1) };
    return { size: 'md', text: line };
  });
}

export function formatStack(lines: StackLine[]): string {
  if (!lines.some((l) => l.text.length)) return '';
  return lines.map((l) => `${l.size === 'lg' ? '^' : l.size === 'sm' ? '_' : ''}${l.text}`).join('\n');
}

/**
 * Excel wraps a multi-line cell in quotes and doubles any quote inside it.
 * A paste that is not that one field is returned with line breaks normalized.
 */
export function unwrapPastedCell(text: string): string {
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (t.endsWith('\n') && quotedField(t.slice(0, -1))) t = t.slice(0, -1);
  if (!quotedField(t)) return t;
  return t.slice(1, -1).replace(/""/g, '"');
}

function quotedField(t: string): boolean {
  if (t.length < 2 || t[0] !== '"' || t.at(-1) !== '"' || !t.includes('\n')) return false;
  return !t.slice(1, -1).replace(/""/g, '').includes('"');
}

/** Words only, for the row subtitle, search, and PDF / CSV / Excel. */
export function stackPlain(raw: string): string {
  if (!raw) return '';
  return parseStack(raw)
    .map((l) => l.text)
    .join('\n')
    .replace(/\n+$/, '');
}
