import JSZip from 'jszip';
import { newId } from '../core/pipeline';
import type { Project, Version } from '../core/types';
import { store } from '../storage/store';
import { gfxTypeLabel, gfxTypesOf, gfxXlsxLabels, isGfxTemp } from '../core/gfxCategories';
import { buildPDF } from './pdf';
import { buildTable, tableToCSV, type ExportTable } from './table';
import { buildXlsx } from './xlsx';

export function download(data: Blob, fileName: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const fileSafe = (s: string) => s.replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_') || 'export';

export interface ExportRequest {
  project: Project;
  episodeName: string;
  version: Version;
  baseline?: Version;
  categories: string[];
  format: 'pdf' | 'csv' | 'zip' | 'xlsx';
}

/** Run an export and trigger the download. Returns the file name. */
function tablesFor(req: ExportRequest, splitGfx: boolean): ExportTable[] {
  const tables: ExportTable[] = [];
  for (const cat of req.project.categories) {
    if (!req.categories.includes(cat.key) || !req.version.items[cat.key]) continue;
    const labels = splitGfx && cat.key === 'gfx' ? gfxXlsxLabels(cat.label, req.project.settings) : null;
    if (!labels) {
      tables.push(buildTable(req.project.id, cat, req.version, req.baseline));
      continue;
    }
    const types = gfxTypesOf(req.project.settings) ?? [];
    tables.push(buildTable(req.project.id, cat, req.version, req.baseline));
    for (const type of types) {
      tables.push(buildTable(req.project.id, { ...cat, label: type.label }, req.version, req.baseline, (it) => gfxTypeLabel(it) === type.label));
    }
    tables.push(buildTable(req.project.id, { ...cat, label: 'Temp' }, req.version, req.baseline, isGfxTemp));
  }
  return tables;
}

export async function runExport(req: ExportRequest): Promise<string> {
  const tables = tablesFor(req, req.format === 'xlsx');
  if (!tables.length) throw new Error('Nothing to export — the selected categories have no files in this version.');
  const stem = fileSafe(`${req.project.name}_${req.episodeName}_${req.version.label}`);

  if (req.format === 'pdf') {
    const bytes = await buildPDF(tables, { project: req.project.name, episode: req.episodeName, version: req.version.label });
    const name = `${stem}_${tables.length === 1 ? fileSafe(tables[0].category.label) : 'Trackers'}.pdf`;
    download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
    return name;
  }

  if (req.format === 'xlsx') {
    const bytes = await buildXlsx(tables, (key) => store.getBlob(key));
    const name = `${stem}_${tables.length === 1 ? fileSafe(tables[0].category.label) : 'Trackers'}.xlsx`;
    download(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    return name;
  }

  if (req.format === 'csv' && tables.length === 1) {
    const name = `${stem}_${fileSafe(tables[0].category.label)}.csv`;
    download(new Blob([tableToCSV(tables[0])], { type: 'text/csv;charset=utf-8' }), name);
    return name;
  }

  // ZIP: one CSV per category + screenshots/ + evidence/ folders.
  const zip = new JSZip();
  for (const t of tables) {
    const folder = tables.length > 1 ? zip.folder(fileSafe(t.category.label))! : zip;
    folder.file(`${fileSafe(t.category.label)}.csv`, tableToCSV(t));
    if (req.format === 'zip') {
      for (const row of t.rows)
        for (const c of row)
          for (const im of c.images ?? []) {
            const b = await store.getBlob(im.key);
            if (b) folder.file(im.path, b);
          }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const name = `${stem}_${req.format === 'zip' ? 'with_images' : 'CSVs'}.zip`;
  download(blob, name);
  return name;
}

/* ------------------------------------------------------------------ */
/* Project backup (.syncgrid.zip)                                      */
/* ------------------------------------------------------------------ */

export async function exportBackup(project: Project, includeScreenshots: boolean): Promise<string> {
  const zip = new JSZip();
  const keys = await store.listBlobKeys(`${project.id}/`);
  const manifest: { key: string; file: string; type: string }[] = [];
  let i = 0;
  for (const key of keys) {
    if (!includeScreenshots && key.includes('/shot/')) continue;
    const b = await store.getBlob(key);
    if (!b) continue;
    const file = `blobs/${String(i++).padStart(5, '0')}`;
    zip.file(file, b);
    manifest.push({ key, file, type: b.type });
  }
  zip.file('project.json', JSON.stringify(project));
  zip.file('blobs.json', JSON.stringify(manifest));
  zip.file('README.txt', 'SyncGrid project backup. Import it from the SyncGrid home screen → Import backup.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const name = `${fileSafe(project.name)}_${new Date().toISOString().slice(0, 10)}.syncgrid.zip`;
  download(blob, name);
  return name;
}

export async function importBackup(file: File): Promise<Project> {
  if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('Backup is larger than 2 GB.');
  const zip = await JSZip.loadAsync(file);
  const pj = zip.file('project.json');
  if (!pj) throw new Error('Not a SyncGrid backup (project.json missing).');
  const raw = await pj.async('string');
  const parsed = JSON.parse(raw) as Project;
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.episodes) || !Array.isArray(parsed.categories)) {
    throw new Error('Unrecognized backup format.');
  }
  // Import as a new project so nothing existing is overwritten.
  const oldId = parsed.id;
  const nextId = newId();
  const remapped = JSON.parse(raw.split(`${oldId}/`).join(`${nextId}/`)) as Project;
  remapped.id = nextId;
  remapped.name = `${parsed.name} (imported)`;
  remapped.updatedAt = new Date().toISOString();

  const manifestFile = zip.file('blobs.json');
  const manifest: { key: string; file: string; type: string }[] = manifestFile ? JSON.parse(await manifestFile.async('string')) : [];
  for (const m of manifest) {
    if (typeof m.key !== 'string' || !m.key.startsWith(`${oldId}/`)) continue;
    const f = zip.file(m.file);
    if (!f) continue;
    const data = await f.async('blob');
    await store.putBlob(`${nextId}/${m.key.slice(oldId.length + 1)}`, new Blob([data], { type: m.type || 'application/octet-stream' }));
  }
  // File handles can't travel between machines.
  for (const e of remapped.episodes) for (const v of e.versions) if (v.video) v.video.hasHandle = false;
  await store.saveProject(remapped);
  return remapped;
}
