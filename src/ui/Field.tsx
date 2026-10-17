import { useEffect, useMemo, useRef, useState } from 'react';
import { autoValue } from '../core/importer';
import { formatStack, parseStack, stackPlain, unwrapPastedCell, type StackLine } from '../core/stackText';
import { isTimecode, tcToFrames } from '../core/timecode';
import type { CategoryConfig, CellValue, CheckValue, ColumnDef, ImageRef, Item, Version } from '../core/types';
import { captureAt, shotFrameOf } from '../media/screenshots';
import { addEvidence, app, removeEvidence, setItemEdge, setValue, toast } from '../state/app';
import { useStore } from '../state/createStore';
import { blobKeys } from '../storage/store';
import { CommitInput, DropZone, Icon, StatusPill, safeHref } from './common';
import { useBlobUrl } from './hooks';

/** Plain-text value of any cell (search, CSV, PDF). */
export function cellText(col: ColumnDef, item: Item, version: Version): string {
  if (col.type === 'auto') return col.auto ? autoValue(item, col.auto, version.rate) : '';
  const v = item.values[col.id];
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return col.id === 'text' ? stackPlain(v) : v;
  if (typeof v === 'boolean') return v ? 'Yes' : '';
  if (Array.isArray(v)) return v.map((r) => r.name).join(', ');
  const c = v as CheckValue;
  return c.checked ? (c.date ? `Yes (${c.date})` : 'Yes') : '';
}

/** All distinct values used in a column across the project (for combo suggestions). */
function useColumnSuggestions(catKey: string, colId: string): string[] {
  const project = useStore(app, (s) => s.project);
  return useMemo(() => {
    const set = new Set<string>();
    for (const e of project?.episodes ?? [])
      for (const v of e.versions)
        for (const it of v.items[catKey] ?? []) {
          const val = it.values[colId];
          if (typeof val === 'string' && val.trim()) set.add(val.trim());
        }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [project, catKey, colId]);
}

const SIZE_LABEL: Record<StackLine['size'], string> = { lg: 'Large line', md: 'Normal line', sm: 'Small line' };
const NEXT_SIZE: Record<StackLine['size'], StackLine['size']> = { md: 'lg', lg: 'sm', sm: 'md' };

/** Stacked lines for the GFX Text column. Enter adds a line; A changes its size. */
function StackField({ value, onCommit, hint }: { value: string; onCommit: (v: string) => void; hint?: boolean }) {
  const [lines, setLines] = useState(() => parseStack(value));
  const linesRef = useRef(lines);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = useRef<number | null>(null);

  useEffect(() => {
    const next = parseStack(value);
    linesRef.current = next;
    setLines(next);
  }, [value]);

  useEffect(() => {
    if (focusAt.current === null) return;
    const i = focusAt.current;
    focusAt.current = null;
    inputs.current[i]?.focus();
  });

  const commit = (next: StackLine[]) => {
    const cleaned = next.length ? next : [{ size: 'md' as const, text: '' }];
    linesRef.current = cleaned;
    setLines(cleaned);
    const formatted = formatStack(cleaned);
    if (formatted !== value) onCommit(formatted);
  };

  const write = (i: number, text: string) => {
    const next = linesRef.current.map((l, j) => (j === i ? { ...l, text } : l));
    linesRef.current = next;
    setLines(next);
  };

  return (
    <div className="stack" title="Enter adds a line. A changes that line’s size.">
      {lines.map((line, i) => (
        <div key={i} className={`stack-line is-${line.size}`}>
          <button
            type="button"
            className="stack-size"
            aria-label={`${SIZE_LABEL[line.size]}. Click to change.`}
            title={SIZE_LABEL[line.size]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(linesRef.current.map((l, j) => (j === i ? { ...l, size: NEXT_SIZE[l.size] } : l)))}
          >
            A
          </button>
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            className="input"
            value={line.text}
            aria-label={`Text line ${i + 1}`}
            onChange={(e) => write(i, e.target.value)}
            onBlur={() => commit(linesRef.current)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text/plain');
              if (!/[\r\n]/.test(text)) return;
              e.preventDefault();
              const parts = unwrapPastedCell(text).split('\n');
              const next = [...linesRef.current];
              const start = e.currentTarget.selectionStart ?? next[i].text.length;
              const end = e.currentTarget.selectionEnd ?? start;
              const [first, ...rest] = parts;
              next[i] = { ...next[i], text: next[i].text.slice(0, start) + first + next[i].text.slice(end) };
              next.splice(i + 1, 0, ...rest.map((t) => ({ size: next[i].size, text: t })));
              focusAt.current = i + rest.length;
              commit(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const next = [...linesRef.current];
                next.splice(i + 1, 0, { size: 'md', text: '' });
                focusAt.current = i + 1;
                commit(next);
              }
              if (e.key === 'Backspace' && linesRef.current[i].text === '' && linesRef.current.length > 1) {
                e.preventDefault();
                focusAt.current = Math.max(0, i - 1);
                commit(linesRef.current.filter((_, j) => j !== i));
              }
              if (e.key === 'Escape') {
                const next = parseStack(value);
                linesRef.current = next;
                setLines(next);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="linkish stack-add"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          focusAt.current = linesRef.current.length;
          commit([...linesRef.current, { size: 'md', text: '' }]);
        }}
      >
        + line
      </button>
      {hint && <span className="stack-hint">Enter adds a line. A changes its size.</span>}
    </div>
  );
}

export function Field({
  col,
  item,
  version,
  cat,
  compact,
}: {
  col: ColumnDef;
  item: Item;
  version: Version;
  cat: CategoryConfig;
  compact?: boolean;
}) {
  const set = (v: CellValue) => setValue(version.id, cat.key, item.id, col.id, v);
  const raw = item.values[col.id];
  const str = typeof raw === 'string' ? raw : '';

  switch (col.type) {
    case 'auto':
      if (col.auto === 'screenshot') return <Shot version={version} item={item} />;
      if (col.auto === 'recIn' || col.auto === 'recOut')
        return <RangeField which={col.auto === 'recIn' ? 'in' : 'out'} item={item} version={version} cat={cat} />;
      {
        const text = autoValue(item, col.auto!, version.rate);
        const wrap = text.includes('\n');
        return <span className={`auto ${wrap ? 'pre' : ''} ${/rec|src|dur/.test(col.auto ?? '') ? 'mono' : ''}`}>{text || '—'}</span>;
      }
    case 'text':
      return <CommitInput value={str} onCommit={set} />;
    case 'longtext':
      if (col.id === 'text') return <StackField value={str} onCommit={set} hint={!compact} />;
      return <CommitInput value={str} onCommit={set} multiline />;
    case 'link': {
      const href = safeHref(str);
      return (
        <div className="link-field">
          <CommitInput value={str} onCommit={set} placeholder="https://" />
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Open link">
              <Icon name="external" size={14} />
            </a>
          )}
        </div>
      );
    }
    case 'select':
    case 'status':
      return (
        <div className="select-field">
          <select className="input" value={str} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            {(col.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {str && !(col.options ?? []).includes(str) && <option value={str}>{str}</option>}
          </select>
          {col.type === 'status' && !compact && <StatusPill value={str} />}
        </div>
      );
    case 'combo':
      return <ComboField catKey={cat.key} col={col} value={str} onCommit={set} />;
    case 'checkbox': {
      const c: CheckValue = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as CheckValue) : { checked: raw === true };
      return (
        <label className="check-field">
          <input
            type="checkbox"
            checked={!!c.checked}
            onChange={(e) =>
              set(e.target.checked ? { checked: true, date: col.stampDate ? new Date().toISOString().slice(0, 10) : undefined } : { checked: false })
            }
          />
          {c.checked && c.date && <span className="muted small">{c.date}</span>}
        </label>
      );
    }
    case 'date':
      return <CommitInput type="date" value={str} onCommit={set} />;
    case 'images':
      return <EvidenceField version={version} cat={cat} item={item} col={col} compact={compact} />;
    default:
      return null;
  }
}

function RangeField({
  which,
  item,
  version,
  cat,
}: {
  which: 'in' | 'out';
  item: Item;
  version: Version;
  cat: CategoryConfig;
}) {
  const tb = version.rate.timebase;
  const shown = autoValue(item, which === 'in' ? 'recIn' : 'recOut', version.rate);
  return (
    <CommitInput
      className="mono"
      value={shown}
      onCommit={(raw) => {
        const frame = tcToFrames(raw.trim(), tb);
        if (!isTimecode(raw.trim()) || !Number.isFinite(frame)) {
          toast('Enter a timecode like 01:00:00:00', 'error');
          return false;
        }
        const other = which === 'in' ? item.recOut : item.recIn;
        if (which === 'in' ? frame >= other : frame <= other) {
          toast('In has to be before out.', 'error');
          return false;
        }
        if (!setItemEdge(version.id, cat.key, item.id, which, frame)) return false;
        if (item.shotFrame === undefined && item.kind === 'video' && cat.columns.some((c) => c.auto === 'screenshot' && !c.hidden)) {
          const recIn = which === 'in' ? frame : item.recIn;
          const recOut = which === 'out' ? frame : item.recOut;
          void captureAt(version, item, shotFrameOf({ ...item, recIn, recOut }, cat));
        }
      }}
    />
  );
}

function ComboField({ catKey, col, value, onCommit }: { catKey: string; col: ColumnDef; value: string; onCommit: (v: string) => void }) {
  const options = useColumnSuggestions(catKey, col.id);
  const id = `dl-${catKey}-${col.id}`;
  return (
    <>
      <CommitInput value={value} onCommit={onCommit} list={id} />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function Shot({ version, item, large }: { version: Version; item: Item; large?: boolean }) {
  const pid = useStore(app, (s) => s.project?.id ?? '');
  const url = useBlobUrl(item.kind === 'video' ? blobKeys.shot(pid, version.id, item.id) : undefined);
  if (item.kind !== 'video') return <span className="shot shot-audio">audio</span>;
  return url ? <img className={`shot ${large ? 'shot-lg' : ''}`} src={url} alt="" loading="lazy" /> : <span className={`shot shot-empty ${large ? 'shot-lg' : ''}`} />;
}

function EvidenceField({
  version,
  cat,
  item,
  col,
  compact,
}: {
  version: Version;
  cat: CategoryConfig;
  item: Item;
  col: ColumnDef;
  compact?: boolean;
}) {
  const refs = Array.isArray(item.values[col.id]) ? (item.values[col.id] as ImageRef[]) : [];
  const [focus, setFocus] = useState(false);
  const add = (files: File[]) => void addEvidence(version.id, cat.key, item.id, col.id, files);
  return (
    <div
      className={`evidence ${focus ? 'is-focus' : ''}`}
      tabIndex={0}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) {
          e.preventDefault();
          add(files);
        }
      }}
      title="Drop, paste (⌘V) or click + to attach images / PDFs"
    >
      {refs.map((r) => (
        <EvidenceThumb key={r.key} r={r} onRemove={() => removeEvidence(version.id, cat.key, item.id, col.id, r.key)} />
      ))}
      <DropZone accept="image/*,application/pdf" multiple onFiles={add} className="evidence-add">
        <Icon name="plus" size={14} />
        {!compact && !refs.length && <span>Drop, paste or browse</span>}
      </DropZone>
    </div>
  );
}

function EvidenceThumb({ r, onRemove }: { r: ImageRef; onRemove: () => void }) {
  const url = useBlobUrl(r.key);
  return (
    <span className="ev-thumb">
      <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" title={r.name}>
        {r.type === 'application/pdf' ? <span className="ev-pdf">PDF</span> : url ? <img src={url} alt={r.name} /> : <span className="ev-pdf">…</span>}
      </a>
      <button className="ev-remove" onClick={onRemove} aria-label={`Remove ${r.name}`}>
        <Icon name="x" size={10} />
      </button>
    </span>
  );
}
