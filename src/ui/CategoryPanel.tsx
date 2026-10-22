import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ItemChange } from '../core/diff';
import { stripExtension } from '../core/naming';
import { stackPlain } from '../core/stackText';
import type { RepeatInfo } from '../core/pipeline';
import { deltaLabel, durationTC, framesToTC } from '../core/timecode';
import type { CategoryConfig, Item, Version } from '../core/types';
import { captureAt, shotFrameOf } from '../media/screenshots';
import { gfxTypeLabel, gfxTypesOf, isGfxTemp } from '../core/gfxCategories';
import { proposedText } from '../core/proofread/osos';
import { subtitleCheck } from '../core/proofread/rules';
import type { Finding } from '../core/proofread/types';
import { GfxCategoryFilter } from './GfxCategories';
import { GfxProfileSelect, SubtitleProfileSelect } from './Profiles';
import { addItem, app, deleteItem, mergeWithNext, playback, renameItem, splitItem, updateProject, type ItemFilter } from '../state/app';
import { useStore } from '../state/createStore';
import { Button, CommitInput, cssVars, Icon, StatusPill, Swatch } from './common';
import { cellText, Field, Shot } from './Field';
import { useCompare, useDiff, useRepeats, useVersion } from './hooks';
import { player, seekToItem } from './Player';

export function itemTitle(item: Item, cat: CategoryConfig): string {
  if (cat.grouping === 'music') return item.auto.cueTitle || stripExtension(item.name);
  if (cat.extractArchivalIds && item.auto.archivalId) return item.auto.archivalId;
  return stripExtension(item.name);
}

export function itemSubtitle(item: Item, cat: CategoryConfig): string {
  if (cat.grouping === 'music') {
    const typed = item.values.artist;
    const artist = typeof typed === 'string' && typed.trim() ? typed : item.auto.artist;
    return [artist, item.auto.library || (item.values.library as string)].filter(Boolean).join(' · ');
  }
  if (cat.extractArchivalIds) {
    const src = item.srcIn ? `${item.srcIn} – ${item.srcOut}` : '';
    return [item.auto.usage, item.auto.archivalId ? stripExtension(item.auto.fileName ?? '') : '', src].filter(Boolean).join(' · ');
  }
  if (cat.source === 'srt') return (item.auto.subtitle ?? '').split('\n').slice(1).join(' · ');
  const text = typeof item.values.text === 'string' ? stackPlain(item.values.text).replace(/\s*\n\s*/g, ' · ') : '';
  return text || item.auto.resolution || '';
}

function gfxTag(item: Item, types: { label: string; short: string }[]): string {
  const type = types.find((t) => t.label === gfxTypeLabel(item));
  return [type?.short, isGfxTemp(item) ? 'Temp' : ''].filter(Boolean).join(' · ');
}

const FILTERS: { key: ItemFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'changes', label: 'Changed' },
  { key: 'new', label: 'New' },
  { key: 'repeats', label: 'Repeats' },
  { key: 'flags', label: 'Flags' },
  { key: 'checks', label: 'Checks' },
];

export function CategoryPanel({ cat }: { cat: CategoryConfig }) {
  const version = useVersion()!;
  const base = useCompare();
  const diff = useDiff(cat);
  const repeats = useRepeats(cat);
  const filter = useStore(app, (s) => s.filters[cat.key] ?? 'all');
  const search = useStore(app, (s) => s.search);
  const selected = useStore(app, (s) => (s.selected?.cat === cat.key ? s.selected.id : null));
  const items = version.items[cat.key];
  const ruleId = useStore(app, (s) => s.project?.settings.subtitleRules);
  const ruleConfig = useStore(app, (s) => s.project?.settings.subtitleProfiles?.find((p) => p.id === s.project?.settings.subtitleRules)?.config);
  const gfxTypes = useStore(app, (s) => (s.project ? gfxTypesOf(s.project.settings) : null));
  const gfxFilter = useStore(app, (s) => s.gfxFilter);
  const checks = useMemo(
    () => (cat.source === 'srt' ? subtitleCheck(version.slots[cat.key]?.srt?.text, items, ruleId, ruleConfig) : { byItem: new Map<string, Finding[]>(), file: [] as Finding[] }),
    [cat.source, cat.key, version, items, ruleId, ruleConfig],
  );
  const statusCol = cat.columns.find((c) => c.type === 'status' && !c.hidden);
  const [showRemoved, setShowRemoved] = useState(false);

  // Which item is under the playhead (cheap: returns an id string).
  const nowId = useStore(playback, (s) => {
    const list = items ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (s.frame >= it.recIn && s.frame < it.recOut) return it.id;
    }
    return null;
  });

  const visible = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const ch = diff?.changes.get(it.id);
      if (filter === 'changes' && !(ch && ch.kind !== 'same')) return false;
      if (filter === 'new' && ch?.kind !== 'new') return false;
      if (filter === 'repeats' && !repeats.has(it.id)) return false;
      if (filter === 'flags' && !it.flags.length) return false;
      if (filter === 'checks' && ruleId && ruleId !== 'off' && !(checks.byItem.get(it.id) ?? []).some((f) => f.severity !== 'INFO')) return false;
      if (cat.key === 'gfx' && gfxTypes && gfxFilter.length) {
        const shown = gfxFilter.some((id) => (id === 'temp' ? isGfxTemp(it) : gfxTypes.some((t) => t.id === id && t.label === gfxTypeLabel(it))));
        if (!shown) return false;
      }
      if (q) {
        const hay = [it.name, itemTitle(it, cat), itemSubtitle(it, cat), ...cat.columns.map((c) => cellText(c, it, version))]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, search, diff, repeats, cat, version, checks, ruleId, gfxTypes, gfxFilter]);

  const counts = diff?.counts;
  const changedCount = counts ? counts.new + counts.changed + counts.shifted : 0;

  return (
    <section className="panel" style={cssVars({ '--c': cat.color })}>
      <header className="panel-head">
        <div className="panel-title">
          <Swatch color={cat.color} />
          <h3>{cat.label}</h3>
          <span className="count">{items?.length ?? 0}</span>
        </div>
        <div className="panel-tools">
          {cat.source === 'srt' && <SubtitleProfileSelect />}
          {cat.key === 'gfx' && <GfxProfileSelect wide />}
          {cat.key === 'gfx' && gfxTypes && <GfxCategoryFilter types={gfxTypes} />}
          <button className="icon-btn" title="Add an entry at the playhead" aria-label={`Add a ${cat.label} entry`} onClick={() => addItem(version.id, cat.key)}>
            <Icon name="plus" size={15} />
          </button>
          <button
            className="icon-btn"
            title="Columns"
            aria-label={`Edit ${cat.label} columns`}
            onClick={() => app.set({ modal: { type: 'columns', catKey: cat.key } })}
          >
            <Icon name="columns" size={15} />
          </button>
        </div>
      </header>
      {items && (
        <div className="filters" role="tablist">
          {FILTERS.map((f) => {
            const n =
              f.key === 'all'
                ? items.length
                : f.key === 'changes'
                  ? changedCount
                  : f.key === 'new'
                    ? (counts?.new ?? 0)
                    : f.key === 'repeats'
                      ? repeats.size
                      : f.key === 'checks'
                        ? items.filter((i) => (checks.byItem.get(i.id) ?? []).some((x) => x.severity !== 'INFO')).length
                        : items.filter((i) => i.flags.length).length;
            if ((f.key === 'changes' || f.key === 'new') && !diff) return null;
            if ((f.key === 'new' || f.key === 'flags' || f.key === 'checks') && n === 0 && filter !== f.key) return null;
            if (f.key === 'checks' && cat.source !== 'srt') return null;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`chip ${filter === f.key ? 'is-on' : ''}`}
                onClick={() => app.set((s) => ({ filters: { ...s.filters, [cat.key]: f.key } }))}
              >
                {f.label}
                <span className="chip-n">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {diff && base && (
        <div className="diff-summary">
          vs <strong>{base.label}</strong>: {counts!.new} new · {counts!.changed} changed · {counts!.shifted} shifted · {counts!.removed} removed
        </div>
      )}
      {checks.file.length > 0 && (
        <div className="check-file">
          <CueChecks findings={checks.file} />
        </div>
      )}
      <div className="panel-list">
        {!items || (items.length === 0 && !search.trim() && filter === 'all') ? (
          <div className="panel-empty">
            <p>No {cat.label} entries for this version yet.</p>
            <Button small icon="upload" onClick={() => app.set({ modal: { type: 'setup', versionId: version.id } })}>
              {cat.source === 'srt' ? 'Add SRT' : 'Add XML / EDL'}
            </Button>
            <Button small icon="plus" onClick={() => addItem(version.id, cat.key)}>
              Add an entry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel-empty muted">Nothing matches.</div>
        ) : (
          visible.map((it) => (
            <Row
              key={it.id}
              item={it}
              cat={cat}
              version={version}
              selected={selected === it.id}
              now={nowId === it.id}
              change={diff?.changes.get(it.id)}
              repeat={repeats.get(it.id)}
              status={statusCol ? (it.values[statusCol.id] as string) : ''}
              findings={checks.byItem.get(it.id) ?? []}
              tag={gfxTypes ? gfxTag(it, gfxTypes) : ''}
            />
          ))
        )}
        {diff && diff.removed.length > 0 && (
          <div className="removed">
            <button className="removed-toggle" onClick={() => setShowRemoved(!showRemoved)}>
              <Icon name={showRemoved ? 'chevDown' : 'chevRight'} size={14} />
              Removed since {base?.label} ({diff.removed.length})
            </button>
            {showRemoved &&
              diff.removed.map((it) => (
                <div className="row row-removed" key={it.id}>
                  <span className="mono">{framesToTC(it.recIn, version.rate.timebase)}</span>
                  <span className="row-title">{itemTitle(it, cat)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

const Row = memo(function Row({
  item,
  cat,
  version,
  selected,
  now,
  change,
  repeat,
  status,
  findings,
  tag,
}: {
  item: Item;
  cat: CategoryConfig;
  version: Version;
  selected: boolean;
  now: boolean;
  change?: ItemChange;
  repeat?: RepeatInfo;
  status: string;
  findings: Finding[];
  tag?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tb = version.rate.timebase;
  const hasShot = cat.columns.some((c) => c.auto === 'screenshot' && !c.hidden);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const proposed = proposedText(item.auto.subtitle || item.name, findings);

  const nextRepeat = () => {
    if (!repeat) return;
    const i = repeat.ids.indexOf(item.id);
    const id = repeat.ids[(i + 1) % repeat.ids.length];
    const target = version.items[cat.key]?.find((x) => x.id === id);
    if (target) seekToItem(cat.key, target);
  };

  return (
    <div ref={ref} className={`row ${selected ? 'is-selected' : ''} ${now ? 'is-now' : ''}`}>
      <div
        className="row-main"
        role="button"
        tabIndex={0}
        onClick={() => (selected ? app.set({ selected: null }) : seekToItem(cat.key, item))}
        onKeyDown={(e) => e.key === 'Enter' && seekToItem(cat.key, item)}
      >
        {hasShot && <Shot version={version} item={item} />}
        <div className="row-body">
          <div className="row-line1">
            <span className="mono tc">{framesToTC(item.recIn, tb)}</span>
            {proposed ? (
              <ProposedCue original={item.auto.subtitle || item.name} proposed={proposed} />
            ) : (
              <span className="row-title" title={item.name}>
                {itemTitle(item, cat)}
              </span>
            )}
          </div>
          <div className="row-line2">
            <span className="mono muted">{durationTC(item.recOut - item.recIn, tb).replace(/^00:(00:)?/, '')}</span>
            {!proposed && <span className="muted ellipsis">{itemSubtitle(item, cat)}</span>}
          </div>
          <div className="badges">
            {tag && <span className="badge badge-type">{tag}</span>}
            {change && change.kind === 'new' && <span className="badge badge-new">New</span>}
            {change && change.kind === 'changed' && (
              <span className="badge badge-changed" title={change.summary.join(' · ')}>
                {change.summary.find((s) => !s.startsWith('Moved')) ?? 'Changed'}
              </span>
            )}
            {change && (change.kind === 'shifted' || (change.kind === 'changed' && change.moved !== 0)) && (
              <span className="badge badge-shift" title="Moved in the timeline (content unchanged)">
                {deltaLabel(change.moved, tb)}
              </span>
            )}
            {repeat && (
              <button
                className="badge badge-repeat"
                title="Used more than once — click to jump to the next use"
                onClick={(e) => {
                  e.stopPropagation();
                  nextRepeat();
                }}
              >
                <Icon name="repeat" size={11} /> Used {repeat.count}×
              </button>
            )}
            {item.segments.length > 1 && <span className="badge">{item.segments.length} pieces</span>}
            {item.flags.length > 0 && (
              <span className="badge badge-flag" title={item.flags.join('\n')}>
                <Icon name="warn" size={11} /> {item.flags.length}
              </span>
            )}
            <CheckBadges findings={findings} />
            {status && <StatusPill value={status} />}
          </div>
        </div>
      </div>
      {selected && <Detail item={item} cat={cat} version={version} change={change} findings={findings} />}
    </div>
  );
});

function CheckBadges({ findings }: { findings: Finding[] }) {
  const errors = findings.filter((f) => f.severity === 'ERROR');
  const warns = findings.filter((f) => f.severity === 'WARN');
  if (!errors.length && !warns.length) return null;
  return (
    <>
      {errors.length > 0 && (
        <span className="badge badge-check-error" title={errors.map((f) => f.message).join('\n')}>
          {errors.length}
        </span>
      )}
      {warns.length > 0 && (
        <span className="badge badge-check-warn" title={warns.map((f) => f.message).join('\n')}>
          {warns.length}
        </span>
      )}
    </>
  );
}

export function ProposedCue({ original, proposed }: { original: string; proposed: string }) {
  return (
    <div className="cue-proposal">
      <div className="cue-old">{original}</div>
      <div className="cue-new">{proposed}</div>
    </div>
  );
}

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

function Detail({ item, cat, version, change, findings }: { item: Item; cat: CategoryConfig; version: Version; change?: ItemChange; findings: Finding[] }) {
  const proposedDetail = proposedText(item.auto.subtitle || item.name, findings);
  const [showSegs, setShowSegs] = useState(false);
  const hasVideo = useStore(app, (s) => !!s.videoUrls[version.id]);
  const tb = version.rate.timebase;
  const cols = cat.columns.filter((c) => !c.hidden && c.auto !== 'screenshot');
  const shotCol = cat.columns.find((c) => c.auto === 'screenshot' && !c.hidden);

  const pin = (frame: number | undefined) => {
    updateProject((p) => {
      for (const e of p.episodes)
        for (const v of e.versions) {
          if (v.id !== version.id) continue;
          const it = v.items[cat.key]?.find((x) => x.id === item.id);
          if (!it) continue;
          if (frame === undefined) delete it.shotFrame;
          else it.shotFrame = frame;
          delete it.capturedFrame;
        }
    });
    const project = app.get().project;
    const fresh = project?.episodes.flatMap((e) => e.versions).find((v) => v.id === version.id)?.items[cat.key]?.find((i) => i.id === item.id);
    const catNow = project?.categories.find((c) => c.key === cat.key) ?? cat;
    if (fresh) void captureAt(version, fresh, shotFrameOf(fresh, catNow));
  };
  const retake = (delta: number) => {
    const last = Math.max(item.recIn, item.recOut - 1);
    pin(Math.min(last, Math.max(item.recIn, shotFrameOf(item, cat) + delta)));
  };

  return (
    <div className="detail">
      {item.manual && (
        <label className="field">
          <span>Name</span>
          <CommitInput value={item.name} onCommit={(v) => renameItem(version.id, cat.key, item.id, v)} />
        </label>
      )}
      {shotCol && item.kind === 'video' && (
        <div className="detail-shot">
          <Shot version={version} item={item} large />
          <div className="shot-adjust">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasVideo} onClick={() => retake(-tb)} title="One second earlier">
              −1s
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasVideo} onClick={() => retake(-1)} title="One frame earlier">
              −1f
            </button>
            <span className="mono small">{framesToTC(shotFrameOf(item, cat), tb)}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasVideo} onClick={() => retake(1)} title="One frame later">
              +1f
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasVideo} onClick={() => retake(tb)} title="One second later">
              +1s
            </button>
          </div>
          {hasVideo ? (
            <div className="shot-adjust">
              <Button small variant="ghost" icon="camera" onClick={() => pin(playback.get().frame)} title="Use the frame under the playhead as this item's screenshot">
                Use current frame
              </Button>
              {item.shotFrame !== undefined && (
                <button type="button" className="linkish" onClick={() => pin(undefined)} title="Go back to the automatic frame">
                  Automatic
                </button>
              )}
            </div>
          ) : (
            <span className="muted small">Load the video to change the screenshot.</span>
          )}
        </div>
      )}
      {change && change.kind !== 'same' && change.summary.length > 0 && <div className="detail-change">{change.summary.join(' · ')}</div>}
      {proposedDetail && <ProposedCue original={item.auto.subtitle || item.name} proposed={proposedDetail} />}
      {findings.length > 0 && <CueChecks findings={findings} />}
      {item.flags.length > 0 && (
        <ul className="detail-flags">
          {item.flags.map((f) => (
            <li key={f}>
              <Icon name="warn" size={12} /> {f}
            </li>
          ))}
        </ul>
      )}
      <div className="detail-grid">
        {cols.map((c) => (
          <label key={c.id} className={`field ${c.type === 'longtext' || c.type === 'images' ? 'span-2' : ''}`}>
            <span>{c.label}</span>
            <Field col={c} item={item} version={version} cat={cat} />
          </label>
        ))}
      </div>
      <div className="detail-actions">
        <button className="linkish" onClick={() => setShowSegs(!showSegs)}>
          <Icon name={showSegs ? 'chevDown' : 'chevRight'} size={13} /> {item.segments.length} timeline piece{item.segments.length > 1 ? 's' : ''}
        </button>
        <span className="spacer" />
        {cat.grouping !== 'none' && item.segments.length > 1 && (
          <Button small variant="ghost" icon="split" onClick={() => splitItem(version.id, cat.key, item.id)} title="Split back into separate entries">
            Split
          </Button>
        )}
        <Button small variant="ghost" icon="merge" onClick={() => mergeWithNext(version.id, cat.key, item.id)} title="Merge with the next entry">
          Merge with next
        </Button>
        <Button
          small
          variant="danger"
          icon="trash"
          onClick={() => {
            const again = item.manual ? '' : ' Importing the XML again will not bring it back.';
            if (confirm(`Remove “${itemTitle(item, cat)}”?${again}`)) deleteItem(version.id, cat.key, item.id);
          }}
        >
          Delete
        </Button>
      </div>
      {showSegs && (
        <table className="segs">
          <tbody>
            {item.segments.map((s, i) => (
              <tr key={i} onClick={() => player.seek(s.recIn)}>
                <td className="mono">{framesToTC(s.recIn, tb)}</td>
                <td className="mono">{framesToTC(s.recOut, tb)}</td>
                <td className="mono muted">{s.tracks.join(',')}</td>
                <td className="ellipsis" title={s.name}>
                  {s.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
