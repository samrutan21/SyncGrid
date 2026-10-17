import { useEffect, useState } from 'react';
import { newId } from '../../core/pipeline';
import { GFX_CATEGORY_SETS, gfxTypesOf } from '../../core/gfxCategories';
import { SUBTITLE_RULE_SETS } from '../../core/proofread/rules';
import { isTimecode, rateLabel, type Rate } from '../../core/timecode';
import type { CategoryConfig, ColumnTemplate, GroupingMode } from '../../core/types';
import { applyTemplate, deleteProject, reprocessAll, saveTemplate, setGfxCategories, updateCategories, updateProject } from '../../state/app';
import { store } from '../../storage/store';
import { AddGfxType } from '../GfxCategories';
import { Button, CommitInput, Icon, Modal, PromptModal, Swatch } from '../common';
import { useProject } from '../hooks';

const RATES: Rate[] = [
  { timebase: 24, ntsc: true },
  { timebase: 24, ntsc: false },
  { timebase: 25, ntsc: false },
  { timebase: 30, ntsc: true },
  { timebase: 30, ntsc: false },
  { timebase: 60, ntsc: true },
];

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const p = useProject()!;
  const s = p.settings;
  const [dirty, setDirty] = useState(false);
  const [templates, setTemplates] = useState<ColumnTemplate[]>([]);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    void store.listTemplates().then(setTemplates);
  }, []);

  const set = (fn: (d: typeof p) => void, affectsImport = true) => {
    updateProject(fn);
    if (affectsImport) setDirty(true);
  };

  return (
    <Modal
      wide
      title="Project settings"
      onClose={() => {
        if (dirty) reprocessAll();
        onClose();
      }}
      footer={
        <>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              if (confirm(`Delete “${p.name}” and everything in it? This can’t be undone.`)) {
                void deleteProject(p.id);
                onClose();
              }
            }}
          >
            Delete project
          </Button>
          <span className="spacer" />
          {dirty && <span className="muted small">Versions will be re-processed with the new rules.</span>}
          <Button
            variant="primary"
            onClick={() => {
              if (dirty) reprocessAll();
              onClose();
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="settings">
        <section>
          <h4>Project</h4>
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <CommitInput value={p.name} onCommit={(v) => set((d) => void (d.name = v || d.name), false)} />
            </label>
            <label className="field">
              <span>Default video start TC</span>
              <CommitInput
                className={isTimecode(s.defaultVideoStartTC) ? '' : 'invalid'}
                value={s.defaultVideoStartTC}
                onCommit={(v) => set((d) => void (d.settings.defaultVideoStartTC = v.trim()), false)}
              />
            </label>
            <label className="field">
              <span>Subtitle rules</span>
              <select
                className="input"
                aria-label="Subtitle rules"
                value={s.subtitleRules || 'off'}
                onChange={(e) =>
                  set((d) => {
                    if (e.target.value === 'off') delete d.settings.subtitleRules;
                    else d.settings.subtitleRules = e.target.value;
                  }, false)
                }
              >
                {SUBTITLE_RULE_SETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>GFX categories</span>
              <select
                className="input"
                aria-label="GFX categories"
                value={s.gfxCategories || 'off'}
                onChange={(e) => setGfxCategories(e.target.value)}
              >
                {GFX_CATEGORY_SETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {gfxTypesOf(s) && (
              <label className="field span-2">
                <span>Category types</span>
                <span className="muted small">{gfxTypesOf(s)!.map((t) => t.label).join(', ')}</span>
                <AddGfxType />
              </label>
            )}
            <label className="field">
              <span>Picture start (FFOA)</span>
              <CommitInput value={s.pictureStartTC} onCommit={(v) => set((d) => void (d.settings.pictureStartTC = v.trim()), false)} />
            </label>
            <label className="field">
              <span>Frame rate for EDL-only imports</span>
              <select
                className="input"
                value={`${s.fallbackRate.timebase}-${s.fallbackRate.ntsc}`}
                onChange={(e) => {
                  const r = RATES.find((x) => `${x.timebase}-${x.ntsc}` === e.target.value);
                  if (r) set((d) => void (d.settings.fallbackRate = r));
                }}
              >
                {RATES.map((r) => (
                  <option key={`${r.timebase}-${r.ntsc}`} value={`${r.timebase}-${r.ntsc}`}>
                    {rateLabel(r)} fps
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section>
          <h4>Archival IDs</h4>
          <div className="form-grid">
            <label className="field">
              <span>ID prefixes (comma separated)</span>
              <CommitInput
                value={s.archivalPrefixes.join(', ')}
                placeholder="OSOS, ARC"
                onCommit={(v) => set((d) => void (d.settings.archivalPrefixes = v.split(/[\s,]+/).filter(Boolean)))}
              />
            </label>
            <label className="field">
              <span>Type letters (one per line, e.g. F = Footage)</span>
              <CommitInput
                multiline
                value={Object.entries(s.sourceTypeLetters).map(([k, v]) => `${k} = ${v}`).join('\n')}
                onCommit={(v) =>
                  set((d) => {
                    const map: Record<string, string> = {};
                    for (const l of lines(v)) {
                      const [k, ...rest] = l.split('=');
                      if (k?.trim() && rest.length) map[k.trim().toUpperCase().slice(0, 3)] = rest.join('=').trim();
                    }
                    d.settings.sourceTypeLetters = map;
                  })
                }
              />
            </label>
            <label className="field">
              <span>Archival repeat = same source overlapping by at least (seconds)</span>
              <CommitInput
                type="number"
                value={String(s.archivalRepeatMinSeconds)}
                onCommit={(v) => set((d) => void (d.settings.archivalRepeatMinSeconds = Math.max(0, Number(v) || 0)), false)}
              />
            </label>
          </div>
        </section>

        <section>
          <h4>Clip rules</h4>
          <div className="form-grid">
            <label className="field">
              <span>Ignore clips named (one per line)</span>
              <CommitInput multiline value={s.ignoreClips.join('\n')} onCommit={(v) => set((d) => void (d.settings.ignoreClips = lines(v)))} />
            </label>
            <label className="field">
              <span>Music: words stripped from the end of cue names (stems/versions)</span>
              <CommitInput
                multiline
                value={s.musicStripWords.join(' ')}
                onCommit={(v) => set((d) => void (d.settings.musicStripWords = v.split(/\s+/).filter(Boolean)))}
              />
            </label>
            <label className="field">
              <span>Music library prefixes (e.g. ES_ = Epidemic Sound)</span>
              <CommitInput
                multiline
                value={Object.entries(s.libraryPrefixes).map(([k, v]) => `${k} = ${v}`).join('\n')}
                onCommit={(v) =>
                  set((d) => {
                    const map: Record<string, string> = {};
                    for (const l of lines(v)) {
                      const [k, ...rest] = l.split('=');
                      if (k?.trim() && rest.length) map[k.trim()] = rest.join('=').trim();
                    }
                    d.settings.libraryPrefixes = map;
                  })
                }
              />
            </label>
          </div>
        </section>

        <section>
          <h4>Categories</h4>
          <div className="cat-table">
            {p.categories.map((c) => (
              <CategoryRow key={c.key} cat={c} onChange={() => setDirty(true)} />
            ))}
          </div>
          <Button
            small
            icon="plus"
            onClick={() => {
              const key = `cat-${newId().slice(0, 8)}`;
              updateCategories((cats) =>
                cats.push({
                  key,
                  label: 'New category',
                  color: '#c08cff',
                  grouping: 'none',
                  gapFrames: 0,
                  extractArchivalIds: false,
                  screenshotAt: 'mid',
                  columns: [
                    { id: 'screenshot', label: 'Screenshot', type: 'auto', auto: 'screenshot', width: 1.4 },
                    { id: 'recIn', label: 'TC In', type: 'auto', auto: 'recIn' },
                    { id: 'recOut', label: 'TC Out', type: 'auto', auto: 'recOut' },
                    { id: 'duration', label: 'Duration', type: 'auto', auto: 'duration' },
                    { id: 'clipName', label: 'Clip Name', type: 'auto', auto: 'clipName', width: 2.4 },
                    { id: 'notes', label: 'Notes', type: 'longtext', width: 2 },
                  ],
                }),
              );
            }}
          >
            Add category
          </Button>
        </section>

        <section>
          <h4>Column templates</h4>
          <p className="muted small">Save this project’s categories and columns to reuse on new projects.</p>
          <div className="template-list">
            {templates.map((t) => (
              <div key={t.id} className="template-row">
                <span>{t.name}</span>
                <span className="muted small">{t.categories.map((c) => c.label).join(' · ')}</span>
                <span className="spacer" />
                <Button
                  small
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Replace this project's columns with “${t.name}”? Notes in removed columns are kept but hidden.`)) applyTemplate(t);
                  }}
                >
                  Apply
                </Button>
                <button
                  className="icon-btn"
                  aria-label="Delete template"
                  onClick={async () => {
                    await store.deleteTemplate(t.id);
                    setTemplates(await store.listTemplates());
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <Button small icon="plus" onClick={() => setNaming(true)}>
            Save current setup as template
          </Button>
        </section>
      </div>
      {naming && (
        <PromptModal
          title="Save template"
          label="Template name"
          initial={`${p.name} columns`}
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            await saveTemplate(name || 'Template');
            setTemplates(await store.listTemplates());
          }}
        />
      )}
    </Modal>
  );
}

function CategoryRow({ cat, onChange }: { cat: CategoryConfig; onChange: () => void }) {
  const upd = (fn: (c: CategoryConfig) => void) => {
    updateCategories((cats) => {
      const c = cats.find((x) => x.key === cat.key);
      if (c) fn(c);
    });
    onChange();
  };
  return (
    <div className="cat-row">
      <label className="color-pick" title="Color">
        <Swatch color={cat.color} />
        <input type="color" value={cat.color} onChange={(e) => upd((c) => void (c.color = e.target.value))} />
      </label>
      <CommitInput value={cat.label} onCommit={(v) => upd((c) => void (c.label = v || c.label))} />
      <select className="input" value={cat.grouping} onChange={(e) => upd((c) => void (c.grouping = e.target.value as GroupingMode))}>
        <option value="adjacent">Group copies/extensions (GFX)</option>
        <option value="music">Group stems/versions/edits (music)</option>
        <option value="none">Every cut separate (archival)</option>
      </select>
      <label className="mini-field" title="Pieces closer than this merge; further apart = a separate use">
        <span>Gap</span>
        <CommitInput type="number" value={String(cat.gapFrames)} onCommit={(v) => upd((c) => void (c.gapFrames = Math.max(0, Math.round(Number(v) || 0))))} />
        <span className="muted small">fr</span>
      </label>
      <label className="check-field" title="Extract Archival IDs and source type from clip names">
        <input type="checkbox" checked={cat.extractArchivalIds} onChange={(e) => upd((c) => void (c.extractArchivalIds = e.target.checked))} />
        <span className="small">IDs</span>
      </label>
      <select className="input" value={cat.screenshotAt} onChange={(e) => upd((c) => void (c.screenshotAt = e.target.value as 'in' | 'mid'))} title="Screenshot frame">
        <option value="mid">Shot: middle</option>
        <option value="in">Shot: first frame</option>
      </select>
      <button
        className="icon-btn"
        aria-label={`Remove ${cat.label}`}
        onClick={() => {
          if (confirm(`Remove the “${cat.label}” category from this project? Its imported data is removed from every version.`)) {
            updateCategories((cats) => {
              const i = cats.findIndex((c) => c.key === cat.key);
              if (i >= 0) cats.splice(i, 1);
            });
            updateProject((p) => {
              for (const e of p.episodes)
                for (const v of e.versions) {
                  delete v.items[cat.key];
                  delete v.slots[cat.key];
                }
            });
          }
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}
