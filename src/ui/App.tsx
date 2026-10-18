import { useEffect, useRef, useState } from 'react';
import { importBackup } from '../export/files';
import { captureMissing } from '../media/screenshots';
import { attachDemoVideos, openDemo } from '../demo';
import { loadSampleProject, sampleAvailable } from '../sample';
import { addEpisode, addVersion, app, createProject, deleteProject, init, openProject, refreshProjects, toast } from '../state/app';
import { useStore } from '../state/createStore';
import { store } from '../storage/store';
import type { ColumnTemplate } from '../core/types';
import { CategoryPanel } from './CategoryPanel';
import { Button, cssVars, DropZone, Icon, Modal, PromptModal } from './common';
import { useProject, useVersion } from './hooks';
import { ColumnEditor } from './modals/ColumnEditor';
import { ExportDialog } from './modals/ExportDialog';
import { SettingsModal } from './modals/Settings';
import { VersionSetup } from './modals/VersionSetup';
import { Player, player } from './Player';
import { SheetView } from './SheetView';
import { TopBar } from './TopBar';

/** Open a project from the list. The public demo puts its hosted picture back. */
async function openListedProject(id: string) {
  await openProject(id);
  if (import.meta.env.VITE_DEMO === '1') await attachDemoVideos();
}

export function App() {
  const ready = useStore(app, (s) => s.ready);
  const project = useProject();
  const toastMsg = useStore(app, (s) => s.toast);

  useEffect(() => {
    void (async () => {
      await init();
      // The public site is a separate build. Local dev never sets this.
      if (import.meta.env.VITE_DEMO === '1') {
        app.set({ ready: false });
        try {
          await openDemo();
        } finally {
          app.set({ ready: true });
        }
      }
    })();
  }, []);

  return (
    <>
      {!ready ? <div className="boot">Loading…</div> : project ? <Workspace /> : <Home />}
      {toastMsg && (
        <div className={`toast toast-${toastMsg.tone}`} role="status">
          {toastMsg.text}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => app.set({ toast: null })}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Workspace() {
  const project = useProject()!;
  const version = useVersion();
  const view = useStore(app, (s) => s.view);
  const enabled = useStore(app, (s) => s.enabled);
  const modal = useStore(app, (s) => s.modal);
  const url = useStore(app, (s) => (version ? s.videoUrls[version.id] : undefined));
  const holdCapture = useStore(app, (s) => s.holdCaptureFor);
  const close = () => app.set({ modal: null });
  const cats = project.categories.filter((c) => enabled.includes(c.key));
  const defaultSide = (n: number) => Math.round(Math.min(window.innerWidth * 0.62, Math.max(360, 330 * Math.max(1, n))));
  const [sideW, setSideW] = useState(() => defaultSide(cats.length));
  const dragging = useRef(false);

  useEffect(() => setSideW(defaultSide(cats.length)), [cats.length]);

  // Capture screenshots once a video is loaded and its start timecode is settled.
  useEffect(() => {
    if (version && url && holdCapture !== version.id) void captureMissing(version);
  }, [url, version?.id, version?.items, holdCapture]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: space play/pause, ←/→ frame, ⇧←/→ 1s, ↑/↓ previous/next marker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || app.get().modal) return;
      const v = version;
      if (!v) return;
      if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const n = (e.shiftKey ? Math.round(v.rate.timebase) : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
        player.step(n);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const s = app.get();
        const keys = s.selected ? [s.selected.cat] : s.enabled;
        const all = keys.flatMap((k) => (v.items[k] ?? []).map((it) => ({ k, it }))).sort((a, b) => a.it.recIn - b.it.recIn);
        if (!all.length) return;
        const cur = s.selected ? all.findIndex((x) => x.it.id === s.selected!.id) : -1;
        const next = all[Math.min(all.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
        app.set({ selected: { cat: next.k, id: next.it.id } });
        player.seek(next.it.recIn);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [version]);

  return (
    <div className="app">
      <TopBar />
      {!version ? (
        <EmptyProject />
      ) : view === 'sheet' ? (
        <SheetView />
      ) : (
        <main className="review" style={cssVars({ '--side': `${sideW}px` })}>
          <Player />
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragging.current) setSideW(Math.min(window.innerWidth - 420, Math.max(300, window.innerWidth - e.clientX)));
            }}
            onPointerUp={() => (dragging.current = false)}
          />
          <aside className="side" style={{ gridTemplateColumns: `repeat(${Math.max(1, cats.length)}, minmax(0, 1fr))` }}>
            {cats.length ? cats.map((c) => <CategoryPanel key={c.key} cat={c} />) : <div className="panel-empty">Turn on a tracker above.</div>}
          </aside>
        </main>
      )}
      {modal?.type === 'setup' && <VersionSetup versionId={modal.versionId} onClose={close} />}
      {modal?.type === 'settings' && <SettingsModal onClose={close} />}
      {modal?.type === 'export' && <ExportDialog onClose={close} />}
      {modal?.type === 'columns' && <ColumnEditor catKey={modal.catKey} onClose={close} />}
    </div>
  );
}

function EmptyProject() {
  const project = useProject()!;
  const [asking, setAsking] = useState(!project.episodes.length);
  const ep = project.episodes.find((e) => e.id === app.get().episodeId);
  return (
    <div className="empty-project">
      <h2>{ep ? `${ep.name} has no versions yet` : 'Start with an episode'}</h2>
      <p className="muted">
        Each version gets its own video plus an XML and EDL slot for GFX, Cue Sheet and Archival. Add as many versions as you like and
        switch between them to track changes.
      </p>
      <Button
        variant="primary"
        icon="plus"
        onClick={() => {
          if (ep) {
            const vid = addVersion(ep.id, 'Version 1');
            app.set({ modal: { type: 'setup', versionId: vid } });
          } else setAsking(true);
        }}
      >
        {ep ? 'Add first version' : 'New episode'}
      </Button>
      {asking && !ep && (
        <PromptModal
          title="New episode"
          label="Episode name (it can be picked up from your XML later)"
          initial="Episode 1"
          confirm="Create"
          onClose={() => setAsking(false)}
          onSubmit={(n) => {
            const id = addEpisode(n);
            const vid = addVersion(id, 'Version 1');
            app.set({ modal: { type: 'setup', versionId: vid } });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Home() {
  const projects = useStore(app, (s) => s.projects);
  const [naming, setNaming] = useState(false);
  const [hasSample, setHasSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ColumnTemplate[]>([]);

  useEffect(() => {
    void sampleAvailable().then(setHasSample);
    void store.listTemplates().then(setTemplates);
  }, []);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-brand">
          <span className="brand-mark lg" aria-hidden="true" />
          <div>
            <h1>Cutsheet</h1>
            <p className="muted">GFX, cue sheet and archival tracking from your timeline’s XML/EDL — on picture, across versions.</p>
          </div>
        </div>

        <div className="home-actions">
          <Button variant="primary" icon="plus" onClick={() => setNaming(true)}>
            New project
          </Button>
          <DropZone
            accept=".zip"
            className="btn btn-subtle"
            onFiles={async (f) => {
              try {
                const p = await importBackup(f[0]);
                await refreshProjects();
                await openListedProject(p.id);
                toast(`Imported “${p.name}”.`);
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            <Icon name="upload" /> Import backup
          </DropZone>
          {hasSample && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await loadSampleProject();
                } catch (e) {
                  toast((e as Error).message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Loading sample…' : 'Load sample project'}
            </Button>
          )}
        </div>

        <h3 className="home-h">Projects</h3>
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="project-card" onClick={() => void openListedProject(p.id)}>
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {p.episodes} episode{p.episodes === 1 ? '' : 's'} · updated {new Date(p.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => {
                    if (confirm(`Delete “${p.name}”? This can’t be undone.`)) void deleteProject(p.id);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small home-foot">
          Everything stays in this browser on this computer. Use Export → Project backup to move a project or share it.
        </p>
      </div>
      {naming && <NewProjectModal templates={templates} onClose={() => setNaming(false)} />}
    </div>
  );
}

function NewProjectModal({ templates, onClose }: { templates: ColumnTemplate[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const submit = () => {
    void createProject(name, templates.find((t) => t.id === templateId));
    onClose();
  };
  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Project name</span>
        <input className="input" autoFocus value={name} placeholder="e.g. Series name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      <label className="field">
        <span>Columns</span>
        <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Default (GFX · Cue Sheet · Archival)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              Template: {t.name}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}
