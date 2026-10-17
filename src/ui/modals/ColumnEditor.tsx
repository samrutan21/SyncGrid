import { newId } from '../../core/pipeline';
import type { AutoField, ColumnDef, ColumnType } from '../../core/types';
import { reprocessAll, updateCategories } from '../../state/app';
import { Button, CommitInput, Icon, Modal, Swatch } from '../common';
import { useProject } from '../hooks';

const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'link', label: 'Link' },
  { value: 'status', label: 'Status (colored)' },
  { value: 'select', label: 'Dropdown' },
  { value: 'combo', label: 'Text + remembers entries' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'images', label: 'Images / PDFs' },
  { value: 'auto', label: 'Auto (from timeline)' },
];

export const AUTO_FIELDS: { value: AutoField; label: string }[] = [
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'recIn', label: 'Record TC in' },
  { value: 'recOut', label: 'Record TC out' },
  { value: 'duration', label: 'Duration (timecode)' },
  { value: 'durationMinSec', label: 'Duration (min:sec)' },
  { value: 'clipName', label: 'Clip name' },
  { value: 'fileName', label: 'File name' },
  { value: 'filePath', label: 'File path' },
  { value: 'srcIn', label: 'Source TC in' },
  { value: 'srcOut', label: 'Source TC out' },
  { value: 'reel', label: 'Reel / tape' },
  { value: 'resolution', label: 'Source resolution' },
  { value: 'tracks', label: 'Tracks / channels' },
  { value: 'segments', label: 'Number of pieces' },
  { value: 'cueTitle', label: 'Cue title (music)' },
  { value: 'artist', label: 'Artist (music)' },
  { value: 'library', label: 'Library (music)' },
  { value: 'logNote', label: 'Clip log note' },
  { value: 'subtitle', label: 'Subtitle text' },
  { value: 'archivalId', label: 'Archival ID' },
  { value: 'sourceType', label: 'Source type (from ID)' },
  { value: 'usage', label: 'Usage type (Video/Audio/Still)' },
];

export function ColumnEditor({ catKey, onClose }: { catKey: string; onClose: () => void }) {
  const project = useProject()!;
  const cat = project.categories.find((c) => c.key === catKey);
  if (!cat) return null;

  const edit = (fn: (cols: ColumnDef[]) => void) =>
    updateCategories((cats) => {
      const c = cats.find((x) => x.key === catKey);
      if (c) fn(c.columns);
    });
  const editCol = (id: string, fn: (c: ColumnDef) => void) =>
    edit((cols) => {
      const c = cols.find((x) => x.id === id);
      if (c) fn(c);
    });
  const move = (i: number, d: number) =>
    edit((cols) => {
      const j = i + d;
      if (j < 0 || j >= cols.length) return;
      [cols[i], cols[j]] = [cols[j], cols[i]];
    });

  return (
    <Modal
      wide
      title={
        <span className="setup-title">
          <Swatch color={cat.color} /> {cat.label} columns
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <span className="muted small">Changes apply to the sidebar, the sheet and every export. Hidden columns keep their data.</span>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="col-editor">
        <div className="col-row col-head">
          <span />
          <span>Name</span>
          <span>Type</span>
          <span>Source / options</span>
          <span>Show</span>
          <span />
        </div>
        {cat.columns.map((c, i) => (
          <div className={`col-row ${c.hidden ? 'is-hidden' : ''}`} key={c.id}>
            <span className="col-move">
              <button className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                <Icon name="chevDown" size={13} className="rot180" />
              </button>
              <button className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === cat.columns.length - 1}>
                <Icon name="chevDown" size={13} />
              </button>
            </span>
            <CommitInput value={c.label} onCommit={(v) => editCol(c.id, (x) => void (x.label = v || x.label))} />
            <select
              className="input"
              value={c.type}
              onChange={(e) =>
                editCol(c.id, (x) => {
                  x.type = e.target.value as ColumnType;
                  if (x.type === 'auto' && !x.auto) x.auto = 'clipName';
                  if ((x.type === 'select' || x.type === 'status') && !x.options?.length) x.options = ['Pending', 'Approved'];
                })
              }
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="col-extra">
              {c.type === 'auto' && (
                <select className="input" value={c.auto} onChange={(e) => editCol(c.id, (x) => void (x.auto = e.target.value as AutoField))}>
                  {AUTO_FIELDS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
              {(c.type === 'select' || c.type === 'status') && (
                <CommitInput
                  value={(c.options ?? []).join(', ')}
                  placeholder="Option A, Option B"
                  onCommit={(v) => editCol(c.id, (x) => void (x.options = v.split(',').map((o) => o.trim()).filter(Boolean)))}
                />
              )}
              {(c.type === 'text' || c.type === 'combo') && (
                <select
                  className="input"
                  value={c.prefill ?? ''}
                  title="Pre-fill empty cells from the timeline"
                  onChange={(e) => {
                    editCol(c.id, (x) => void (x.prefill = (e.target.value || undefined) as AutoField | undefined));
                    reprocessAll();
                  }}
                >
                  <option value="">No pre-fill</option>
                  {AUTO_FIELDS.filter((a) => a.value !== 'screenshot').map((a) => (
                    <option key={a.value} value={a.value}>
                      Pre-fill: {a.label}
                    </option>
                  ))}
                </select>
              )}
              {c.type === 'checkbox' && (
                <label className="check-field">
                  <input type="checkbox" checked={!!c.stampDate} onChange={(e) => editCol(c.id, (x) => void (x.stampDate = e.target.checked))} />
                  <span className="small">Stamp date when checked</span>
                </label>
              )}
            </span>
            <input type="checkbox" checked={!c.hidden} aria-label="Show column" onChange={(e) => editCol(c.id, (x) => void (x.hidden = !e.target.checked))} />
            <button
              className="icon-btn"
              aria-label={`Delete ${c.label}`}
              onClick={() => {
                if (confirm(`Delete the “${c.label}” column? (Hide it instead to keep its data.)`)) edit((cols) => void cols.splice(i, 1));
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <Button small icon="plus" onClick={() => edit((cols) => void cols.push({ id: `col-${newId().slice(0, 8)}`, label: 'New column', type: 'text', width: 1.4 }))}>
          Add column
        </Button>
      </div>
    </Modal>
  );
}
