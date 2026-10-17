import { useMemo, useState } from 'react';
import { parseXMEML } from '../../core/parsers/xmeml';
import { isTimecode } from '../../core/timecode';
import type { CategoryConfig, CategorySlot, Version } from '../../core/types';
import {
  app,
  clearSlotFile,
  deleteVersion,
  pickVideo,
  reprocess,
  renameEpisode,
  renameVersion,
  setSlotFile,
  setSrtZero,
  setTrackFilter,
  suggestLabelsFromText,
  supportsFileHandles,
  toast,
  updateProject,
} from '../../state/app';
import { StartTCField } from '../StartTCField';
import { Button, CommitInput, cssVars, DropZone, Icon, Modal, Swatch } from '../common';
import { useProject } from '../hooks';

/**
 * Per-version setup: one video slot, and an XML + EDL slot for every category.
 * Files never need renaming: the slot decides what a file is.
 */
export function VersionSetup({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const project = useProject()!;
  const ep = project.episodes.find((e) => e.versions.some((v) => v.id === versionId));
  const version = ep?.versions.find((v) => v.id === versionId);
  if (!ep || !version) return null;

  const isDefaultLabel = /^Version \d+$/.test(version.label);
  const isDefaultEp = /^Episode \d+$/.test(ep.name);

  const onFile = async (cat: CategoryConfig, which: 'xml' | 'edl' | 'srt', file: File) => {
    await setSlotFile(version.id, cat.key, which, file);
    if (isDefaultLabel || isDefaultEp) {
      const text = await file.text();
      const s = suggestLabelsFromText(text);
      if (isDefaultLabel && s.version) renameVersion(version.id, s.version);
      if (isDefaultEp && s.episode) renameEpisode(ep.id, s.episode);
    }
  };

  /** Drop everything at once: route by keywords in the file name. */
  const smartDrop = async (files: File[]) => {
    const unrouted: string[] = [];
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (/^(mp4|m4v|mov|webm)$/.test(ext ?? '')) {
        await pickVideo(version.id, f);
        continue;
      }
      if (ext === 'srt' || ext === 'vtt') {
        const cat = project.categories.find((c) => c.source === 'srt');
        if (!cat) unrouted.push(f.name);
        else await setSlotFile(version.id, cat.key, 'srt', f);
        continue;
      }
      if (ext !== 'xml' && ext !== 'edl') {
        unrouted.push(f.name);
        continue;
      }
      const cat = routeByName(f.name, project.categories);
      if (!cat) unrouted.push(f.name);
      else await onFile(cat, ext, f);
    }
    if (unrouted.length) toast(`Couldn’t tell which slot these go in — drop them on a slot: ${unrouted.join(', ')}`, 'error');
  };

  return (
    <Modal
      wide
      title={
        <span className="setup-title">
          <CommitInput className="title-input" value={ep.name} onCommit={(v) => renameEpisode(ep.id, v)} />
          <span className="muted">/</span>
          <CommitInput className="title-input" value={version.label} onCommit={(v) => renameVersion(version.id, v)} />
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              if (confirm(`Delete version “${version.label}” and its notes?`)) {
                void deleteVersion(version.id);
                onClose();
              }
            }}
          >
            Delete version
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <DropZone accept=".xml,.edl,.srt,.vtt,video/*" multiple onFiles={(f) => void smartDrop(f)} className="smart-drop">
        <Icon name="upload" size={18} />
        <div>
          <strong>Drop all files for this version here</strong>
          <span className="muted small">
            Routed by name (GFX, cue/music, archival, subtitles …) — or use the slots below, no renaming needed.
          </span>
        </div>
      </DropZone>

      <VideoSlot version={version} />

      <div className="slot-grid">
        {project.categories.map((c) =>
          c.source === 'srt' ? (
            <SrtSlot key={c.key} cat={c} version={version} onFile={onFile} />
          ) : (
            <CategorySlotCard key={c.key} cat={c} version={version} onFile={onFile} />
          ),
        )}
      </div>
    </Modal>
  );
}

function routeByName(name: string, cats: CategoryConfig[]): CategoryConfig | undefined {
  const n = name.toLowerCase();
  const hints: Record<string, RegExp> = {
    gfx: /(gfx|graphic|titles?|lower.?third|\blt\b)/,
    music: /(cue|music|mx|score|song)/,
    archival: /(archiv|stock|footage|license|clearance)/,
  };
  return (
    cats.find((c) => hints[c.key]?.test(n)) ??
    cats.find((c) => n.includes(c.label.toLowerCase().replace(/\s+/g, '')) || n.includes(c.label.toLowerCase()))
  );
}

function VideoSlot({ version }: { version: Version }) {
  const project = useProject()!;
  const loaded = !!app.get().videoUrls[version.id];
  return (
    <div className="slot-card video-slot">
      <div className="slot-head">
        <Icon name="film" />
        <h4>Video</h4>
        <span className="muted small">H.264 MP4 offline · stays on your computer</span>
      </div>
      <div className="slot-row">
        <div className="slot-file">
          {version.video?.fileName ? (
            <>
              <Icon name="file" size={14} /> {version.video.fileName}
              {!loaded && <span className="muted small"> (not loaded this session)</span>}
            </>
          ) : (
            <span className="muted">No video yet (optional — needed for screenshots)</span>
          )}
        </div>
        <VideoPickButton versionId={version.id} />
        <StartTCField
          versionId={version.id}
          value={version.video?.startTC || project.settings.defaultVideoStartTC}
          detected={version.video?.detectedStartTC}
          from={version.video?.detectedFrom}
        />
      </div>
    </div>
  );
}

function VideoPickButton({ versionId }: { versionId: string }) {
  if (supportsFileHandles()) {
    return (
      <Button small icon="film" onClick={() => void pickVideo(versionId)}>
        Choose video
      </Button>
    );
  }
  return (
    <DropZone accept="video/*" onFiles={(f) => void pickVideo(versionId, f[0])} className="btn btn-subtle btn-sm">
      <Icon name="film" size={14} /> Choose video
    </DropZone>
  );
}

function SrtSlot({
  cat,
  version,
  onFile,
}: {
  cat: CategoryConfig;
  version: Version;
  onFile: (cat: CategoryConfig, which: 'srt', f: File) => Promise<void>;
}) {
  const project = useProject()!;
  const slot = version.slots[cat.key];
  const file = slot?.srt;
  return (
    <div className="slot-card" style={cssVars({ '--c': cat.color })}>
      <div className="slot-head">
        <Swatch color={cat.color} />
        <h4>{cat.label}</h4>
        {slot?.stats && <span className="muted small">{slot.stats.items} entries</span>}
      </div>
      <div className={`slot ${file ? 'is-filled' : ''}`}>
        {file ? (
          <div className="slot-filled" title={file.fileName}>
            <div className="slot-filled-top">
              <span className="slot-kind">SRT</span>
              <span className="muted small">{new Date(file.importedAt).toLocaleDateString()}</span>
              <span className="spacer" />
              <button className="icon-btn" aria-label="Remove srt" onClick={() => clearSlotFile(version.id, cat.key, 'srt')}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <span className="slot-name">{file.fileName}</span>
          </div>
        ) : (
          <DropZone accept=".srt,.vtt" onFiles={(fs) => void onFile(cat, 'srt', fs[0])} className="slot-empty">
            <span className="slot-kind">SRT</span>
            <span className="muted small">Drop or browse</span>
          </DropZone>
        )}
      </div>
      <label className="mini-field wide">
        <span>00:00:00 in the file is</span>
        <CommitInput
          className="mono"
          value={slot?.srtZero || project.settings.pictureStartTC}
          onCommit={(v) => {
            const tc = v.trim();
            if (!isTimecode(tc)) return false;
            if (!setSrtZero(version.id, cat.key, tc)) return false;
          }}
        />
      </label>
      <span className="muted small">A file timed from zero lands on picture start. Change this if the cues don’t match the picture.</span>
      {slot?.warnings?.length ? (
        <ul className="slot-warnings">
          {slot.warnings.map((w) => (
            <li key={w}>
              <Icon name="warn" size={12} /> {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CategorySlotCard({
  cat,
  version,
  onFile,
}: {
  cat: CategoryConfig;
  version: Version;
  onFile: (cat: CategoryConfig, which: 'xml' | 'edl', f: File) => Promise<void>;
}) {
  const project = useProject()!;
  const slot: CategorySlot | undefined = version.slots[cat.key];
  const tracks = useMemo(() => {
    if (!slot?.xml) return [];
    try {
      return parseXMEML(slot.xml.text).tracks;
    } catch {
      return [];
    }
  }, [slot?.xml]);
  const filter = slot?.trackFilter ?? [];
  const [prefixes, setPrefixes] = useState(project.settings.archivalPrefixes.join(', '));

  return (
    <div className="slot-card" style={cssVars({ '--c': cat.color })}>
      <div className="slot-head">
        <Swatch color={cat.color} />
        <h4>{cat.label}</h4>
        {slot?.stats && (
          <span className="muted small">
            {slot.stats.items} entries
            {slot.xml && slot.edl ? ` · ${slot.stats.matched}/${Math.max(slot.stats.xmlEvents, slot.stats.edlEvents)} events paired` : ''}
          </span>
        )}
      </div>
      <div className="slot-pair">
        {(['xml', 'edl'] as const).map((which) => {
          const f = slot?.[which];
          return (
            <div key={which} className={`slot ${f ? 'is-filled' : ''}`}>
              {f ? (
                <div className="slot-filled" title={f.fileName}>
                  <div className="slot-filled-top">
                    <span className="slot-kind">{which.toUpperCase()}</span>
                    <span className="muted small">{new Date(f.importedAt).toLocaleDateString()}</span>
                    <span className="spacer" />
                    <button className="icon-btn" aria-label={`Remove ${which}`} onClick={() => clearSlotFile(version.id, cat.key, which)}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                  <span className="slot-name">{f.fileName}</span>
                </div>
              ) : (
                <DropZone accept={`.${which}`} onFiles={(fs) => void onFile(cat, which, fs[0])} className="slot-empty">
                  <span className="slot-kind">{which.toUpperCase()}</span>
                  <span className="muted small">Drop or browse</span>
                </DropZone>
              )}
            </div>
          );
        })}
      </div>
      {cat.extractArchivalIds && (
        <label className="mini-field wide">
          <span>Archival ID prefix</span>
          <input
            className="input"
            value={prefixes}
            placeholder="e.g. OSOS"
            onChange={(e) => setPrefixes(e.target.value)}
            onBlur={() => {
              const list = prefixes.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
              if (list.join(',') === project.settings.archivalPrefixes.join(',')) return;
              updateProject((p) => {
                p.settings.archivalPrefixes = list;
              });
              for (const e of app.get().project?.episodes ?? []) for (const v of e.versions) reprocess(v.id, [cat.key]);
            }}
          />
          <span className="muted small">
            Finds IDs like {project.settings.archivalPrefixes[0] || 'XXXX'}-F0067 · {Object.entries(project.settings.sourceTypeLetters).map(([k, v]) => `${k}=${v}`).join(', ')}
          </span>
        </label>
      )}
      {tracks.length > 1 && (
        <div className="track-filter">
          <span className="muted small">Tracks:</span>
          {tracks.map((t) => {
            const on = !filter.length || filter.includes(t.label);
            return (
              <button
                key={t.label}
                className={`chip ${on ? 'is-on' : ''}`}
                title={`${t.clipCount} clips`}
                onClick={() => {
                  const all = tracks.map((x) => x.label);
                  const cur = filter.length ? filter : all;
                  const next = on ? cur.filter((x) => x !== t.label) : [...cur, t.label];
                  setTrackFilter(version.id, cat.key, next.length === all.length ? [] : next);
                }}
              >
                {t.label}
                <span className="chip-n">{t.clipCount}</span>
              </button>
            );
          })}
        </div>
      )}
      {slot?.warnings?.length ? (
        <ul className="slot-warnings">
          {slot.warnings.map((w) => (
            <li key={w}>
              <Icon name="warn" size={12} /> {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

