import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { gfxTypeLabel, gfxTypesOf, isGfxTemp, type GfxType } from '../core/gfxCategories';
import { proposedText } from '../core/proofread/osos';
import { subtitleCheck } from '../core/proofread/rules';
import type { Finding } from '../core/proofread/types';
import { framesToTC } from '../core/timecode';
import type { CategoryConfig } from '../core/types';
import { app, toast } from '../state/app';
import { ProposedCue } from './CategoryPanel';
import { GfxSheetTabs } from './GfxCategories';
import { useStore } from '../state/createStore';
import { Button, cssVars, Icon, Swatch } from './common';
import { cellText, Field } from './Field';
import { useDiff, useProject, useRepeats, useVersion } from './hooks';
import { player } from './Player';

function CueChecks({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <ul className="check-list">
      {findings.map((f, i) => (
        <li key={`${f.rule_id}-${i}`} className={`check check-${f.severity}`}>
          <span className="check-sev">{f.severity}</span>
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewCount({ findings }: { findings: Finding[] }) {
  const n = findings.filter((f) => f.severity === 'INFO').length;
  if (!n) return null;
  return (
    <span className="muted small" title={findings.filter((f) => f.severity === 'INFO').map((f) => f.message).join('\n')}>
      {n} to review
    </span>
  );
}

/** Spreadsheet view of one category, editable in place. */
export function SheetView() {
  const project = useProject()!;
  const sheetCat = useStore(app, (s) => s.sheetCat);
  const gfxTypes = catKeyIsGfx(project, sheetCat) ? gfxTypesOf(project.settings) : null;
  const cat = project.categories.find((c) => c.key === sheetCat) ?? project.categories[0];
  if (!cat) return null;
  return (
    <div className="sheet-wrap">
      <div className="sheet-tabs" role="tablist">
        {project.categories.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={c.key === cat.key}
            className={`sheet-tab ${c.key === cat.key ? 'is-on' : ''}`}
            onClick={() => app.set({ sheetCat: c.key })}
          >
            <Swatch color={c.color} /> {c.label}
          </button>
        ))}
        <span className="spacer" />
        <Button small variant="ghost" icon="columns" onClick={() => app.set({ modal: { type: 'columns', catKey: cat.key } })}>
          Columns
        </Button>
      </div>
      {cat.key === 'gfx' && gfxTypes && <GfxSheetTabs types={gfxTypes} />}
      <Sheet cat={cat} gfxTypes={gfxTypes} />
    </div>
  );
}

function catKeyIsGfx(project: { categories: { key: string }[] }, sheetCat: string): boolean {
  return (project.categories.find((c) => c.key === sheetCat) ?? project.categories[0])?.key === 'gfx';
}

/** One cell for a spreadsheet paste. Quotes keep tabs and line breaks inside the cell. */
function tsvCell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tab-separated text plus an HTML table, which is what Google Sheets pastes as cells. */
function sheetClipboard(rows: string[][]): { plain: string; html: string } {
  const plain = rows.map((row) => row.map(tsvCell).join('\t')).join('\n');
  const html = `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`;
  return { plain, html };
}

type CellRef = { item: string; col: string };

function Sheet({ cat, gfxTypes }: { cat: CategoryConfig; gfxTypes: GfxType[] | null }) {
  const version = useVersion()!;
  const diff = useDiff(cat);
  const repeats = useRepeats(cat);
  const search = useStore(app, (s) => s.search);
  const gfxSheet = useStore(app, (s) => s.gfxSheet);
  const items = version.items[cat.key];
  const ruleId = useStore(app, (s) => s.project?.settings.subtitleRules);
  const ruleConfig = useStore(app, (s) => s.project?.settings.subtitleProfiles?.find((p) => p.id === s.project?.settings.subtitleRules)?.config);
  const checks = useMemo(
    () => (cat.source === 'srt' && ruleId && ruleId !== 'off' ? subtitleCheck(version.slots[cat.key]?.srt?.text, items, ruleId, ruleConfig) : null),
    [cat.source, cat.key, version, items, ruleId, ruleConfig],
  );
  const cols = cat.columns.filter((c) => !c.hidden);
  const [picked, setPicked] = useState<string[]>([]);
  const [range, setRange] = useState<{ a: CellRef; b: CellRef } | null>(null);
  const colAnchor = useRef<string | null>(null);
  const cellAnchor = useRef<CellRef | null>(null);
  const dragging = useRef(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const type = gfxTypes?.find((t) => t.id === gfxSheet);
    return (items ?? []).filter((it) => {
      if (cat.key === 'gfx' && gfxTypes && gfxSheet === 'temp' && !isGfxTemp(it)) return false;
      if (cat.key === 'gfx' && type && gfxTypeLabel(it) !== type.label) return false;
      if (!q) return true;
      return cols.some((c) => cellText(c, it, version).toLowerCase().includes(q)) || it.name.toLowerCase().includes(q);
    });
  }, [items, search, cols, version, cat.key, gfxTypes, gfxSheet]);
  const ordered = cols.filter((c) => picked.includes(c.id));
  const cellBox = useMemo(() => {
    if (!range) return null;
    const ar = rows.findIndex((r) => r.id === range.a.item);
    const br = rows.findIndex((r) => r.id === range.b.item);
    const ac = cols.findIndex((c) => c.id === range.a.col);
    const bc = cols.findIndex((c) => c.id === range.b.col);
    if (ar < 0 || br < 0 || ac < 0 || bc < 0) return null;
    const r0 = Math.min(ar, br);
    const r1 = Math.max(ar, br);
    const c0 = Math.min(ac, bc);
    const c1 = Math.max(ac, bc);
    const useCols = cols.slice(c0, c1 + 1);
    const matrix = rows.slice(r0, r1 + 1).map((it) => useCols.map((c) => cellText(c, it, version)));
    return { r0, r1, c0, c1, matrix };
  }, [range, rows, cols, version]);
  const clipboard = useMemo(() => {
    if (cellBox) {
      const n = cellBox.matrix.reduce((sum, row) => sum + row.length, 0);
      return {
        rows: cellBox.matrix,
        note: `Copied ${n} ${n === 1 ? 'cell' : 'cells'}.`,
        cells: true,
        single: n === 1,
        box: { r0: cellBox.r0, c0: cellBox.c0 },
      };
    }
    if (!ordered.length) return null;
    return {
      rows: [ordered.map((c) => c.label), ...rows.map((it) => ordered.map((c) => cellText(c, it, version)))],
      note: `Copied ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}.`,
      cells: false,
      single: false,
      box: null,
    };
  }, [cellBox, ordered, rows, version]);

  useEffect(() => {
    setPicked([]);
    setRange(null);
    colAnchor.current = null;
    cellAnchor.current = null;
  }, [cat.key]);

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (!clipboard || app.get().modal) return;
      const target = e.target instanceof Element ? e.target : null;
      const field = target?.closest('input, textarea, select');
      if (field && !field.closest('.sheet')) return;
      const typing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null;
      if (typing && typing.selectionStart !== typing.selectionEnd && clipboard.single) return;
      if (!clipboard.cells && field) return;
      const sel = window.getSelection();
      if (!clipboard.cells && sel && !sel.isCollapsed) return;
      const grid = clipboard.rows.map((row) => row.slice());
      if (clipboard.cells && clipboard.box && typing) {
        const td = typing.closest('td');
        const tr = td?.parentElement;
        if (td && tr?.parentElement && td.querySelectorAll('input, textarea').length === 1) {
          const r = [...tr.parentElement.children].indexOf(tr) - clipboard.box.r0;
          const c = [...tr.children].indexOf(td) - 1 - clipboard.box.c0;
          if (grid[r]?.[c] !== undefined) grid[r][c] = typing.value;
        }
      }
      const built = sheetClipboard(grid);
      e.preventDefault();
      e.clipboardData?.setData('text/plain', built.plain);
      e.clipboardData?.setData('text/html', built.html);
      toast(clipboard.note);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      setPicked([]);
      setRange(null);
      cellAnchor.current = null;
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clipboard]);

  const pickColumn = (e: ReactMouseEvent, id: string) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setRange(null);
    cellAnchor.current = null;
    const ids = cols.map((c) => c.id);
    if (e.shiftKey && colAnchor.current) {
      const a = ids.indexOf(colAnchor.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) setPicked(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
      return;
    }
    colAnchor.current = id;
    if (e.metaKey || e.ctrlKey) {
      setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      return;
    }
    setPicked((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
  };

  const pickCell = (item: string, col: string, extend: boolean) => {
    setPicked([]);
    const next = { item, col };
    if (extend && cellAnchor.current) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setRange({ a: cellAnchor.current, b: next });
      return;
    }
    cellAnchor.current = next;
    setRange({ a: next, b: next });
  };

  const cellCount = cellBox ? cellBox.matrix.reduce((n, row) => n + row.length, 0) : 0;

  const cellPicked = (colId: string, colIndex: number, rowIndex: number) => {
    if (cellBox) return rowIndex >= cellBox.r0 && rowIndex <= cellBox.r1 && colIndex >= cellBox.c0 && colIndex <= cellBox.c1;
    return picked.includes(colId);
  };

  if (!items) {
    return (
      <div className="panel-empty">
        <p>No {cat.label} files in this version.</p>
        <Button small icon="upload" onClick={() => app.set({ modal: { type: 'setup', versionId: version.id } })}>
          Add XML / EDL
        </Button>
      </div>
    );
  }

  return (
    <div className="sheet-scroll">
      <p className="sheet-copy-hint">
        {cellBox
          ? `${cellCount === 1 ? '1 cell' : `${cellCount} cells`} selected. ⌘C or Ctrl+C copies.`
          : ordered.length > 0
            ? `${ordered.length === 1 ? '1 column' : `${ordered.length} columns`} selected. ⌘C or Ctrl+C copies ${rows.length === 1 ? 'the row' : `${rows.length} rows`}.`
            : ''}
      </p>
      <table className="sheet" style={cssVars({ '--c': cat.color })}>
        <thead>
          <tr>
            <th className="num">#</th>
            {cols.map((c) => (
              <th
                key={c.id}
                style={{ minWidth: `${Math.round((c.width ?? 1) * 90)}px` }}
                className={picked.includes(c.id) ? 'is-picked' : ''}
                title="Click to select this column. Shift-click to select through here. ⌘C or Ctrl+C copies."
                onClick={(e) => pickColumn(e, c.id)}
              >
                {c.label}
              </th>
            ))}
            {checks && <th>Check</th>}
            {diff && <th>Change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => {
            const ch = diff?.changes.get(it.id);
            const rep = repeats.get(it.id);
            return (
              <tr key={it.id} className={ch?.kind === 'new' ? 'is-new' : ch?.kind === 'changed' ? 'is-changed' : ''}>
                <td className="num">
                  <button className="linkish mono" title={`Go to ${framesToTC(it.recIn, version.rate.timebase)}`} onClick={() => { app.set({ selected: { cat: cat.key, id: it.id }, view: 'review' }); player.seek(it.recIn); }}>
                    {i + 1}
                  </button>
                  {rep && <span className="badge badge-repeat" title={`Used ${rep.count}×`}><Icon name="repeat" size={10} /></span>}
                  {it.flags.length > 0 && <span className="badge badge-flag" title={it.flags.join('\n')}><Icon name="warn" size={10} /></span>}
                </td>
                {cols.map((c, ci) => {
                  const proposal = c.auto === 'subtitle' && checks ? proposedText(it.auto.subtitle || it.name, checks.byItem.get(it.id) ?? []) : null;
                  const on = cellPicked(c.id, ci, i);
                  return (
                    <td
                      key={c.id}
                      className={`t-${c.type}${on ? ' is-picked' : ''}`}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        if (e.shiftKey) e.preventDefault();
                        dragging.current = true;
                        dragFrom.current = { x: e.clientX, y: e.clientY };
                        pickCell(it.id, c.id, e.shiftKey);
                      }}
                      onMouseEnter={(e) => {
                        if (!dragging.current || e.buttons !== 1 || !cellAnchor.current || !dragFrom.current) return;
                        const dx = e.clientX - dragFrom.current.x;
                        const dy = e.clientY - dragFrom.current.y;
                        if (dx * dx + dy * dy < 9) return;
                        if (cellAnchor.current.item === it.id && cellAnchor.current.col === c.id) return;
                        window.getSelection()?.removeAllRanges();
                        pickCell(it.id, c.id, true);
                      }}
                    >
                      {proposal ? <ProposedCue original={it.auto.subtitle || it.name} proposed={proposal} /> : <Field col={c} item={it} version={version} cat={cat} compact />}
                    </td>
                  );
                })}
                {checks && (
                  <td className="check-cell">
                    <CueChecks findings={(checks.byItem.get(it.id) ?? []).filter((f) => f.severity !== 'INFO')} />
                    <ReviewCount findings={checks.byItem.get(it.id) ?? []} />
                  </td>
                )}
                {diff && <td className="muted small">{ch && ch.kind !== 'same' ? ch.summary.join(' · ') : ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {diff && diff.removed.length > 0 && (
        <div className="sheet-removed">
          <strong>Removed since baseline ({diff.removed.length}):</strong>{' '}
          {diff.removed.map((r) => `${framesToTC(r.recIn, version.rate.timebase)} ${r.auto.cueTitle || r.auto.archivalId || r.name}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
