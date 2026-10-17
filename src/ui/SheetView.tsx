import { useMemo } from 'react';
import { gfxTypeLabel, gfxTypesOf, isGfxTemp, type GfxType } from '../core/gfxCategories';
import { proposedText } from '../core/proofread/osos';
import { subtitleCheck } from '../core/proofread/rules';
import type { Finding } from '../core/proofread/types';
import { framesToTC } from '../core/timecode';
import type { CategoryConfig } from '../core/types';
import { app } from '../state/app';
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

function Sheet({ cat, gfxTypes }: { cat: CategoryConfig; gfxTypes: GfxType[] | null }) {
  const version = useVersion()!;
  const diff = useDiff(cat);
  const repeats = useRepeats(cat);
  const search = useStore(app, (s) => s.search);
  const gfxSheet = useStore(app, (s) => s.gfxSheet);
  const items = version.items[cat.key];
  const ruleId = useStore(app, (s) => s.project?.settings.subtitleRules);
  const checks = useMemo(
    () => (cat.source === 'srt' && ruleId && ruleId !== 'off' ? subtitleCheck(version.slots[cat.key]?.srt?.text, items, ruleId) : null),
    [cat.source, cat.key, version, items, ruleId],
  );
  const cols = cat.columns.filter((c) => !c.hidden);
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
      <table className="sheet" style={cssVars({ '--c': cat.color })}>
        <thead>
          <tr>
            <th className="num">#</th>
            {cols.map((c) => (
              <th key={c.id} style={{ minWidth: `${Math.round((c.width ?? 1) * 90)}px` }}>
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
                {cols.map((c) => {
                  const proposal = c.auto === 'subtitle' && checks ? proposedText(it.auto.subtitle || it.name, checks.byItem.get(it.id) ?? []) : null;
                  return (
                    <td key={c.id} className={`t-${c.type}`}>
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
