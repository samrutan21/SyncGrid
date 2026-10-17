import { useState } from 'react';
import { exportBackup, runExport } from '../../export/files';
import { app, compareVersion, currentEpisode, toast } from '../../state/app';
import { useStore } from '../../state/createStore';
import { Button, Modal, Swatch } from '../common';
import { useProject } from '../hooks';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProject()!;
  const versionId = useStore(app, (s) => s.versionId);
  const ep = currentEpisode();
  const [vid, setVid] = useState(versionId ?? '');
  const version = ep?.versions.find((v) => v.id === vid);
  const autoBase = compareVersion();
  const [baseId, setBaseId] = useState<string>(autoBase && vid === versionId ? autoBase.id : 'none');
  const [cats, setCats] = useState<string[]>(project.categories.filter((c) => version?.items[c.key]).map((c) => c.key));
  const [format, setFormat] = useState<'pdf' | 'csv' | 'zip' | 'xlsx'>('pdf');
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState(false);

  if (!ep || !version) {
    return (
      <Modal title="Export" onClose={onClose}>
        <p className="muted">Add a version with XML/EDL files first.</p>
      </Modal>
    );
  }
  const baseline = ep.versions.find((v) => v.id === baseId && v.id !== vid);

  const go = async () => {
    setBusy(true);
    try {
      const name = await runExport({ project, episodeName: ep.name, version, baseline, categories: cats, format });
      toast(`Exported ${name}`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="download" disabled={busy || !cats.length} onClick={() => void go()}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="export-form">
        <label className="field">
          <span>Version</span>
          <select className="input" value={vid} onChange={(e) => setVid(e.target.value)}>
            {ep.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {ep.name} · {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Trackers</span>
          <div className="check-list">
            {project.categories.map((c) => (
              <label key={c.key} className={`check-field ${version.items[c.key] ? '' : 'is-disabled'}`}>
                <input
                  type="checkbox"
                  disabled={!version.items[c.key]}
                  checked={cats.includes(c.key)}
                  onChange={(e) => setCats(e.target.checked ? [...cats, c.key] : cats.filter((k) => k !== c.key))}
                />
                <Swatch color={c.color} /> {c.label}
                <span className="muted small">{version.items[c.key]?.length ?? 'no files'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Format</span>
          <div className="seg">
            {(
              [
                ['pdf', 'PDF', 'Formatted, screenshots embedded'],
                ['xlsx', 'Excel', 'Spreadsheet, pictures in the cells'],
                ['csv', 'CSV', 'For spreadsheets (zip if several)'],
                ['zip', 'CSV + images', 'Zip with screenshots & evidence'],
              ] as const
            ).map(([k, label, hint]) => (
              <button key={k} className={`seg-btn ${format === k ? 'is-on' : ''}`} onClick={() => setFormat(k)} title={hint}>
                {label}
                <span className="muted small">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Include change report</span>
          <select className="input" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            <option value="none">No</option>
            {ep.versions
              .filter((v) => v.id !== vid)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  Compared with {v.label}
                </option>
              ))}
          </select>
        </label>
        <hr />
        <div className="field">
          <span>Project backup</span>
          <p className="muted small">
            Everything in this project (all episodes, versions, notes, evidence) as one .zip — for backup or to hand to a teammate,
            who imports it from the home screen. Video files are not included.
          </p>
          <div className="row-inline">
            <label className="check-field">
              <input type="checkbox" checked={shots} onChange={(e) => setShots(e.target.checked)} /> Include screenshots
            </label>
            <span className="spacer" />
            <Button
              small
              icon="download"
              onClick={async () => {
                const name = await exportBackup(project, shots);
                toast(`Saved ${name}`);
              }}
            >
              Download backup
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
