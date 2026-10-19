import { useRef, useState } from 'react';
import {
  addEpisode,
  addVersion,
  app,
  closeProject,
  currentEpisode,
  deleteEpisode,
  moveCategory,
  renameEpisode,
  selectEpisode,
  selectVersion,
  toggleCategory,
} from '../state/app';
import { useStore } from '../state/createStore';
import { captureMissing, cancelCapture } from '../media/screenshots';
import { Button, cssVars, Icon, PromptModal, Swatch } from './common';
import { useCompare, useProject, useVersion } from './hooks';

export function TopBar() {
  const project = useProject()!;
  const version = useVersion();
  const base = useCompare();
  const episodeId = useStore(app, (s) => s.episodeId);
  const compareId = useStore(app, (s) => s.compareId);
  const enabled = useStore(app, (s) => s.enabled);
  const view = useStore(app, (s) => s.view);
  const search = useStore(app, (s) => s.search);
  const capture = useStore(app, (s) => s.capture);
  const hasVideo = useStore(app, (s) => (version ? !!s.videoUrls[version.id] : false));
  const ep = currentEpisode();
  const [prompt, setPrompt] = useState<null | 'episode' | 'renameEpisode'>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);
  const dragged = useRef(false);

  return (
    <header className="topbar">
      <div className="tb-left">
        <button className="brand" onClick={() => void closeProject()} title="All projects">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{project.name}</span>
        </button>

        <div className="tb-group">
          <select
            className="input tb-select"
            aria-label="Episode"
            value={episodeId ?? ''}
            onChange={(e) => {
              if (e.target.value === '__new') setPrompt('episode');
              else if (e.target.value === '__rename') setPrompt('renameEpisode');
              else if (e.target.value === '__delete') {
                if (ep && confirm(`Delete episode “${ep.name}” and all its versions?`)) void deleteEpisode(ep.id);
              } else selectEpisode(e.target.value);
            }}
          >
            {!project.episodes.length && <option value="">No episodes</option>}
            {project.episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value="__new">+ New episode…</option>
            {ep && <option value="__rename">Rename episode…</option>}
            {ep && <option value="__delete">Delete episode…</option>}
          </select>

          {ep && (
            <select
              className="input tb-select"
              aria-label="Version"
              value={version?.id ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new') {
                  const id = addVersion(ep.id, `Version ${ep.versions.length + 1}`);
                  app.set({ modal: { type: 'setup', versionId: id } });
                } else selectVersion(e.target.value);
              }}
            >
              {!ep.versions.length && <option value="">No versions</option>}
              {ep.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
              <option disabled>──────────</option>
              <option value="__new">+ New version…</option>
            </select>
          )}

          {ep && version && ep.versions.length > 1 && (
            <select
              className="input tb-select tb-compare"
              aria-label="Compare with"
              title="Change tracking baseline"
              value={compareId ?? 'auto'}
              onChange={(e) => app.set({ compareId: e.target.value === 'auto' ? null : e.target.value })}
            >
              <option value="auto">{base && !compareId ? `vs ${base.label}` : 'vs previous'}</option>
              {ep.versions
                .filter((v) => v.id !== version.id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    vs {v.label}
                  </option>
                ))}
              <option value="none">No comparison</option>
            </select>
          )}

          {version && (
            <Button small icon="upload" onClick={() => app.set({ modal: { type: 'setup', versionId: version.id } })}>
              Files
            </Button>
          )}
        </div>
      </div>

      <div className="tb-center">
        {version &&
          project.categories.map((c) => {
            const on = enabled.includes(c.key);
            return (
              <button
                key={c.key}
                draggable
                className={`cat-toggle ${on ? 'is-on' : ''} ${over === c.key ? 'is-drop' : ''}`}
                style={cssVars({ '--c': c.color })}
                aria-pressed={on}
                title={`${on ? `Hide ${c.label}` : `Show ${c.label}`}. Drag to reorder.`}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  toggleCategory(c.key);
                }}
                onDragStart={(e) => {
                  dragKey.current = c.key;
                  dragged.current = false;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.key);
                }}
                onDragOver={(e) => {
                  if (!dragKey.current || dragKey.current === c.key) return;
                  e.preventDefault();
                  if (over !== c.key) setOver(c.key);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const key = dragKey.current;
                  dragKey.current = null;
                  setOver(null);
                  if (key) moveCategory(key, c.key);
                }}
                onDragEnd={() => {
                  dragged.current = true;
                  dragKey.current = null;
                  setOver(null);
                }}
              >
                <Swatch color={c.color} />
                {c.label}
                <span className="chip-n">{version.items[c.key]?.length ?? 0}</span>
              </button>
            );
          })}
      </div>

      <div className="tb-right">
        {capture ? (
          <button className="capture-pill" onClick={cancelCapture} title="Click to stop">
            <Icon name="camera" size={13} /> {capture.done}/{capture.total}
          </button>
        ) : (
          version &&
          hasVideo && (
            <button className="icon-btn" title="Capture missing screenshots" onClick={() => void captureMissing(version)}>
              <Icon name="camera" />
            </button>
          )
        )}
        <label className="search">
          <Icon name="search" size={14} />
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => app.set({ search: e.target.value })}
            aria-label="Search items"
          />
        </label>
        <div className="seg seg-sm" role="tablist" aria-label="View">
          <button className={`seg-btn ${view === 'review' ? 'is-on' : ''}`} onClick={() => app.set({ view: 'review' })}>
            <Icon name="film" size={14} /> Review
          </button>
          <button className={`seg-btn ${view === 'sheet' ? 'is-on' : ''}`} onClick={() => app.set({ view: 'sheet' })}>
            <Icon name="table" size={14} /> Sheet
          </button>
        </div>
        <Button small icon="download" onClick={() => app.set({ modal: { type: 'export' } })} disabled={!version}>
          Export
        </Button>
        <button className="icon-btn" title="Project settings" aria-label="Project settings" onClick={() => app.set({ modal: { type: 'settings' } })}>
          <Icon name="gear" />
        </button>
      </div>

      {prompt === 'episode' && (
        <PromptModal
          title="New episode"
          label="Episode name"
          initial={`Episode ${project.episodes.length + 1}`}
          confirm="Create"
          onClose={() => setPrompt(null)}
          onSubmit={(name) => {
            const id = addEpisode(name);
            const vid = addVersion(id, 'Version 1');
            app.set({ modal: { type: 'setup', versionId: vid } });
          }}
        />
      )}
      {prompt === 'renameEpisode' && ep && (
        <PromptModal title="Rename episode" label="Episode name" initial={ep.name} onClose={() => setPrompt(null)} onSubmit={(n) => n.trim() && renameEpisode(ep.id, n.trim())} />
      )}
    </header>
  );
}
