import { diffItems } from '../core/diff';
import { autoValue } from '../core/importer';
import { stackPlain } from '../core/stackText';
import { framesToTC } from '../core/timecode';
import type { CategoryConfig, CheckValue, ColumnDef, ImageRef, Item, Version } from '../core/types';
import { blobKeys } from '../storage/store';

/**
 * Shared table model for CSV and PDF exports: one row per item, cells are
 * either text or a list of image references.
 */

export interface ExportCell {
  text: string;
  images?: { key: string; name: string; type: string; path: string }[];
}

export interface ExportTable {
  category: CategoryConfig;
  columns: { label: string; width: number; isImage: boolean }[];
  rows: ExportCell[][];
  removed: string[][];
  summary?: string;
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80);

export function buildTable(
  projectId: string,
  cat: CategoryConfig,
  version: Version,
  baseline?: Version,
  only?: (item: Item) => boolean,
): ExportTable {
  const cols = cat.columns.filter((c) => !c.hidden);
  const items = [...(version.items[cat.key] ?? [])].filter((it) => !only || only(it)).sort((a, b) => a.recIn - b.recIn);
  const baseItems = baseline?.items[cat.key]?.filter((it) => !only || only(it));
  const diff = baseItems ? diffItems(baseItems, items, version.rate.timebase) : null;
  const tb = version.rate.timebase;

  const columns = [
    { label: '#', width: 0.35, isImage: false },
    ...cols.map((c) => ({ label: c.label, width: c.width ?? 1, isImage: c.auto === 'screenshot' || c.type === 'images' })),
  ];
  if (diff) columns.push({ label: `Change vs ${baseline!.label}`, width: 1.2, isImage: false });

  const rows = items.map((it, i) => {
    const n = String(i + 1).padStart(3, '0');
    const cells: ExportCell[] = [{ text: String(i + 1) }];
    for (const c of cols) cells.push(cell(c, it, version, projectId, `${safeName(cat.label)}_${n}_${framesToTC(it.recIn, tb).replace(/:/g, '-')}`));
    if (diff) {
      const ch = diff.changes.get(it.id);
      cells.push({ text: ch && ch.kind !== 'same' ? ch.summary.join('; ') : '' });
    }
    return cells;
  });

  const removed = (diff?.removed ?? []).map((it) => [framesToTC(it.recIn, tb), framesToTC(it.recOut, tb), it.auto.cueTitle || it.auto.archivalId || it.name]);
  const summary = diff
    ? `vs ${baseline!.label}: ${diff.counts.new} new, ${diff.counts.changed} changed, ${diff.counts.shifted} shifted, ${diff.counts.removed} removed`
    : undefined;
  return { category: cat, columns, rows, removed, summary };
}

function cell(col: ColumnDef, it: Item, version: Version, projectId: string, base: string): ExportCell {
  if (col.type === 'auto') {
    if (col.auto === 'screenshot') {
      if (it.kind !== 'video') return { text: '' };
      const path = `screenshots/${base}.jpg`;
      return { text: path, images: [{ key: blobKeys.shot(projectId, version.id, it.id), name: `${base}.jpg`, type: 'image/jpeg', path }] };
    }
    return { text: autoValue(it, col.auto!, version.rate) };
  }
  const v = it.values[col.id];
  if (v === undefined || v === null) return { text: '' };
  if (typeof v === 'string') return { text: col.id === 'text' ? stackPlain(v) : v };
  if (typeof v === 'boolean') return { text: v ? 'Yes' : '' };
  if (Array.isArray(v)) {
    const imgs = (v as ImageRef[]).map((r, i) => {
      const ext = r.type === 'application/pdf' ? 'pdf' : (r.name.split('.').pop() || 'png').toLowerCase();
      const path = `evidence/${base}_${i + 1}.${safeName(ext)}`;
      return { ...r, path };
    });
    return { text: imgs.map((i) => i.path).join(' | '), images: imgs };
  }
  const c = v as CheckValue;
  return { text: c.checked ? (c.date ? `Yes ${c.date}` : 'Yes') : '' };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

const csvCell = (s: string) => {
  // Neutralize spreadsheet formula injection from clip names / notes.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function tableToCSV(t: ExportTable): string {
  const lines = [t.columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of t.rows) lines.push(r.map((c) => csvCell(c.text)).join(','));
  if (t.removed.length) {
    lines.push('');
    lines.push(csvCell(`Removed since baseline (${t.removed.length})`));
    lines.push(['TC In', 'TC Out', 'Name'].map(csvCell).join(','));
    for (const r of t.removed) lines.push(r.map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
