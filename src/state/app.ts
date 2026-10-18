import { defaultCategories, defaultSettings, ensureSubtitles } from '../core/config/defaults';
import { OSOS_GFX_TYPES, reorderGfxTypes, syncGfxColumns, type GfxType } from '../core/gfxCategories';
import { carryByShot, carryValues } from '../core/diff';
import { isDismissed, moveEdge } from '../core/edits';
import { importCategory, suggestEpisodeName, suggestVersionLabel } from '../core/importer';
import { newId } from '../core/pipeline';
import { DEFAULT_RATE, framesToTC, isTimecode, tcToFrames } from '../core/timecode';
import type {
  CategoryConfig,
  CategorySlot,
  CellValue,
  ColumnTemplate,
  Episode,
  ImageRef,
  Item,
  Project,
  Version,
} from '../core/types';
import { buildSubtitleItems, firstCueFrame, srtZeroFrame } from '../core/parsers/srt';
import { readBurnedStartTC } from '../media/burnedTimecode';
import { readContainerStartTC } from '../media/fileTimecode';
import { blobKeys, store, type ProjectSummary } from '../storage/store';
import { createStore } from './createStore';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type ItemFilter = 'all' | 'changes' | 'new' | 'repeats' | 'flags' | 'checks';
export type Modal =
  | { type: 'setup'; versionId: string }
  | { type: 'settings' }
  | { type: 'export' }
  | { type: 'columns'; catKey: string }
  | { type: 'newVersion' }
  | { type: 'newEpisode' };

export interface AppState {
  ready: boolean;
  projects: ProjectSummary[];
  project: Project | null;
  episodeId: string | null;
  versionId: string | null;
  /** Version to compare against; null = previous version automatically. 'none' = off. */
  compareId: string | null;
  enabled: string[];
  selected: { cat: string; id: string } | null;
  view: 'review' | 'sheet';
  sheetCat: string;
  /** GFX sheet tab. "all", "temp", or a type id. */
  gfxSheet: string;
  /** GFX sidebar categories to show. Empty means every graphic. */
  gfxFilter: string[];
  filters: Record<string, ItemFilter>;
  search: string;
  modal: Modal | null;
  toast: { text: string; tone: 'info' | 'error' } | null;
  /** Object URLs for loaded video files, by version id (memory only). */
  videoUrls: Record<string, string>;
  /** Screenshot capture progress for the current version. */
  capture: { done: number; total: number } | null;
  /** Bumped whenever blobs change so thumbnails refresh. */
  blobRev: number;
  /**
   * While set, screenshot capture waits. Used so frames are grabbed after the
   * file's start timecode has been detected, not against the previous value.
   */
  holdCaptureFor: string | null;
}

export const app = createStore<AppState>({
  ready: false,
  projects: [],
  project: null,
  episodeId: null,
  versionId: null,
  compareId: null,
  enabled: [],
  selected: null,
  view: 'review',
  sheetCat: 'gfx',
  gfxSheet: 'all',
  gfxFilter: [],
  filters: {},
  search: '',
  modal: null,
  toast: null,
  videoUrls: {},
  capture: null,
  blobRev: 0,
  holdCaptureFor: null,
});

/** Playback state is kept separately: it changes many times per second. */
export const playback = createStore({ frame: 0, playing: false, durationSec: 0 });

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function currentEpisode(s: AppState = app.get()): Episode | undefined {
  return s.project?.episodes.find((e) => e.id === s.episodeId);
}
export function currentVersion(s: AppState = app.get()): Version | undefined {
  return currentEpisode(s)?.versions.find((v) => v.id === s.versionId);
}
/** Baseline version for change tracking. */
export function compareVersion(s: AppState = app.get()): Version | undefined {
  const ep = currentEpisode(s);
  if (!ep || s.compareId === 'none') return undefined;
  if (s.compareId) return ep.versions.find((v) => v.id === s.compareId && v.id !== s.versionId);
  const idx = ep.versions.findIndex((v) => v.id === s.versionId);
  return idx > 0 ? ep.versions[idx - 1] : undefined;
}
export function categoryOf(key: string, s: AppState = app.get()): CategoryConfig | undefined {
  return s.project?.categories.find((c) => c.key === key);
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'info' | 'error' = 'info') {
  app.set({ toast: { text, tone } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => app.set({ toast: null }), tone === 'error' ? 7000 : 3500);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: Project | null = null;

function scheduleSave(p: Project) {
  pendingSave = p;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
export async function flushSave() {
  const p = pendingSave;
  pendingSave = null;
  if (!p) return;
  try {
    await store.saveProject(p);
  } catch (e) {
    toast(`Could not save: ${(e as Error).message}`, 'error');
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flushSave());
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}
if (import.meta.hot) import.meta.hot.dispose(() => flushSave());

/** Apply a change to the open project (copy-on-write), then save. */
export function updateProject(fn: (draft: Project) => void) {
  const p = app.get().project;
  if (!p) return;
  const draft = structuredClone(p);
  fn(draft);
  draft.updatedAt = new Date().toISOString();
  app.set({ project: draft });
  scheduleSave(draft);
}

function findVersion(p: Project, versionId: string): Version | undefined {
  for (const e of p.episodes) for (const v of e.versions) if (v.id === versionId) return v;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function init() {
  try {
    const projects = await store.listProjects();
    app.set({ projects, ready: true });
    const last = safeGet('cutsheet:lastProject');
    if (last && projects.some((p) => p.id === last)) await openProject(last);
  } catch (e) {
    app.set({ ready: true });
    toast(`Storage unavailable: ${(e as Error).message}`, 'error');
  }
}

export function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode etc. */
  }
}

export async function refreshProjects() {
  app.set({ projects: await store.listProjects() });
}

export function blankProject(name: string, template?: ColumnTemplate): Project {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: name.trim() || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    categories: template ? structuredClone(template.categories) : defaultCategories(),
    episodes: [],
    schemaVersion: 1,
  };
}

export async function createProject(name: string, template?: ColumnTemplate) {
  const p = blankProject(name, template);
  ensureSubtitles(p.categories);
  await store.saveProject(p);
  await refreshProjects();
  await openProject(p.id);
  return p;
}

export async function openProject(id: string) {
  await flushSave();
  const p = await store.loadProject(id);
  if (!p) return;
  if (ensureSubtitles(p.categories) || syncGfxColumns(p.categories, p.settings)) await store.saveProject(p);
  revokeVideos();
  const ep = p.episodes[0];
  const v = ep?.versions[ep.versions.length - 1];
  app.set({
    project: p,
    episodeId: ep?.id ?? null,
    versionId: v?.id ?? null,
    compareId: null,
    enabled: p.categories.map((c) => c.key),
    selected: null,
    sheetCat: p.settings.gfxCategories && p.settings.gfxCategories !== 'off' && p.categories.some((c) => c.key === 'gfx') ? 'gfx' : (p.categories[0]?.key ?? 'gfx'),
    gfxSheet: 'all',
    gfxFilter: [],
    filters: {},
    view: 'review',
  });
  safeSet('cutsheet:lastProject', id);
  for (const e of p.episodes) {
    for (const ver of e.versions) {
      const keys = p.categories.filter((c) => subtitlePlacementIsStale(ver, c)).map((c) => c.key);
      if (keys.length) reprocess(ver.id, keys);
    }
  }
  if (v) void autoConnectVideo(v.id);
}

/**
 * A 23.976 file imported before cues were read as real time sits a few
 * seconds late. Rebuild once, from the stored SRT, so notes stay.
 */
function subtitlePlacementIsStale(v: Version, cat: CategoryConfig): boolean {
  const slot = v.slots[cat.key];
  if (cat.source !== 'srt' || !slot?.srt) return false;
  const zero = tcToFrames(slot.srtZero ?? '', v.rate.timebase);
  if (!slot.srtZero || Number.isNaN(zero)) return false;
  const built = buildSubtitleItems(slot.srt.text, v.rate, zero).items;
  const items = (v.items[cat.key] ?? []).filter((it) => !it.manual);
  const sample = built.find((b) => items.some((it) => it.groupKey === b.groupKey));
  if (!sample) return false;
  const have = items.filter((it) => it.groupKey === sample.groupKey);
  const drift = (it: Item) => Math.abs(it.recIn - (it.shift?.in ?? 0) - sample.recIn);
  const placed = have.reduce((best, it) => (drift(it) < drift(best) ? it : best));
  return placed.recIn - (placed.shift?.in ?? 0) !== sample.recIn;
}

export async function closeProject() {
  await flushSave();
  revokeVideos();
  app.set({ project: null, episodeId: null, versionId: null, selected: null });
  safeSet('cutsheet:lastProject', null);
  await refreshProjects();
}

export async function deleteProject(id: string) {
  await store.deleteProject(id);
  if (app.get().project?.id === id) app.set({ project: null });
  await refreshProjects();
}

function revokeVideos() {
  for (const url of Object.values(app.get().videoUrls)) URL.revokeObjectURL(url);
  app.set({ videoUrls: {} });
}

/* ------------------------------------------------------------------ */
/* Episodes + versions                                                 */
/* ------------------------------------------------------------------ */

export function addEpisode(name: string): string {
  const id = newId();
  updateProject((p) => {
    p.episodes.push({ id, name: name.trim() || `Episode ${p.episodes.length + 1}`, versions: [] });
  });
  app.set({ episodeId: id, versionId: null, selected: null });
  return id;
}

export function renameEpisode(id: string, name: string) {
  updateProject((p) => {
    const e = p.episodes.find((x) => x.id === id);
    if (e) e.name = name;
  });
}

export async function deleteEpisode(id: string) {
  const p = app.get().project;
  const ep = p?.episodes.find((e) => e.id === id);
  if (!p || !ep) return;
  for (const v of ep.versions) await store.deleteBlobs(blobKeys.shotPrefix(p.id, v.id));
  updateProject((d) => {
    d.episodes = d.episodes.filter((e) => e.id !== id);
  });
  const next = app.get().project?.episodes[0];
  app.set({ episodeId: next?.id ?? null, versionId: next?.versions.at(-1)?.id ?? null, selected: null });
}

export function addVersion(episodeId: string, label: string): string {
  const id = newId();
  updateProject((p) => {
    const ep = p.episodes.find((e) => e.id === episodeId);
    if (!ep) return;
    const prev = ep.versions.at(-1);
    ep.versions.push({
      id,
      label: label.trim() || `Version ${ep.versions.length + 1}`,
      createdAt: new Date().toISOString(),
      rate: prev?.rate ?? p.settings.fallbackRate ?? DEFAULT_RATE,
      seqStartFrame: prev?.seqStartFrame ?? null,
      slots: {},
      items: {},
      carriedFrom: prev?.id,
      video: prev?.video ? { fileName: '', startTC: prev.video.startTC } : undefined,
    });
  });
  app.set({ episodeId, versionId: id, selected: null, compareId: null });
  return id;
}

export function renameVersion(id: string, label: string) {
  updateProject((p) => {
    const v = findVersion(p, id);
    if (v) v.label = label;
  });
}

export async function deleteVersion(id: string) {
  const s = app.get();
  if (!s.project) return;
  await store.deleteBlobs(blobKeys.shotPrefix(s.project.id, id));
  updateProject((p) => {
    for (const e of p.episodes) {
      e.versions = e.versions.filter((v) => v.id !== id);
      for (const v of e.versions) if (v.carriedFrom === id) v.carriedFrom = undefined;
    }
  });
  const ep = currentEpisode();
  app.set({ versionId: ep?.versions.at(-1)?.id ?? null, selected: null, compareId: null });
}

export function selectVersion(id: string) {
  app.set({ versionId: id, selected: null, compareId: null });
  void autoConnectVideo(id);
}
export function selectEpisode(id: string) {
  const ep = app.get().project?.episodes.find((e) => e.id === id);
  const v = ep?.versions.at(-1);
  app.set({ episodeId: id, versionId: v?.id ?? null, selected: null, compareId: null });
  if (v) void autoConnectVideo(v.id);
}

/* ------------------------------------------------------------------ */
/* Slots + import                                                      */
/* ------------------------------------------------------------------ */

const MAX_TIMELINE_FILE = 80 * 1024 * 1024;

export async function setSlotFile(versionId: string, catKey: string, which: 'xml' | 'edl' | 'srt', file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (which === 'xml' && ext !== 'xml') return toast('That slot takes an .xml file (Final Cut Pro XML from Premiere/Resolve).', 'error');
  if (which === 'edl' && ext !== 'edl') return toast('That slot takes an .edl file (CMX3600).', 'error');
  if (which === 'srt' && ext !== 'srt' && ext !== 'vtt') return toast('That slot takes an .srt file.', 'error');
  if (file.size > MAX_TIMELINE_FILE) return toast('File is larger than 80 MB — is this the right file?', 'error');
  const text = await file.text();
  await setSlotText(versionId, catKey, which, file.name, text);
}

export async function setSlotText(versionId: string, catKey: string, which: 'xml' | 'edl' | 'srt', fileName: string, text: string) {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    if (!v) return;
    const slot: CategorySlot = v.slots[catKey] ?? { warnings: [] };
    slot[which] = { fileName, importedAt: new Date().toISOString(), text };
    if (which === 'srt') delete slot.srtZero;
    v.slots[catKey] = slot;
  });
  reprocess(versionId, [catKey]);
}

export function clearSlotFile(versionId: string, catKey: string, which: 'xml' | 'edl' | 'srt') {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    const slot = v?.slots[catKey];
    if (!slot) return;
    delete slot[which];
    if (which === 'srt') delete slot.srtZero;
  });
  reprocess(versionId, [catKey]);
}

/** Keep the active tag list on its profile before another one is selected. */
function stashGfxProfile(p: { settings: import('../core/types').ProjectSettings }) {
  const id = p.settings.gfxCategories;
  if (!id || id === 'off') return;
  const types = (p.settings.gfxTypes ?? (id === 'osos' ? OSOS_GFX_TYPES : [])).map((t) => ({ ...t }));
  const profiles = p.settings.gfxProfiles ? p.settings.gfxProfiles.slice() : [];
  const label = profiles.find((x) => x.id === id)?.label ?? (id === 'osos' ? 'OSOS GFX CATEGORIES' : id);
  const entry = { id, label, types };
  const at = profiles.findIndex((x) => x.id === id);
  if (at >= 0) profiles[at] = entry;
  else profiles.push(entry);
  p.settings.gfxProfiles = profiles;
}

function profileSlug(name: string, taken: string[]): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  if (taken.includes(slug)) {
    let n = 2;
    while (taken.includes(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  return slug;
}

/** Which GFX category set is on. "off" hides the tabs and leaves tags in place. */
export function setGfxCategories(id: string) {
  updateProject((p) => {
    stashGfxProfile(p);
    if (!id || id === 'off') delete p.settings.gfxCategories;
    else {
      p.settings.gfxCategories = id;
      const saved = p.settings.gfxProfiles?.find((x) => x.id === id);
      p.settings.gfxTypes = saved ? saved.types.map((t) => ({ ...t })) : id === 'osos' ? OSOS_GFX_TYPES.map((t) => ({ ...t })) : [];
    }
    syncGfxColumns(p.categories, p.settings);
  });
  if (!id || id === 'off') app.set({ gfxSheet: 'all', gfxFilter: [] });
  else app.set((s) => ({ sheetCat: 'gfx', enabled: s.enabled.includes('gfx') ? s.enabled : ['gfx', ...s.enabled] }));
  void flushSave();
}

/** Add an empty GFX profile and turn it on. Tags are added afterwards. */
export function addGfxProfile(label: string) {
  const name = label.trim();
  if (!name) return;
  if (/^(all|temp|off)$/i.test(name) || name.toLowerCase() === 'osos gfx categories') {
    toast(`“${name}” can’t be a profile.`);
    return;
  }
  let created = '';
  updateProject((p) => {
    const profiles = p.settings.gfxProfiles ?? [];
    if (profiles.some((x) => x.id !== 'osos' && x.label.toLowerCase() === name.toLowerCase())) return;
    stashGfxProfile(p);
    const id = profileSlug(name, ['osos', 'off', ...(p.settings.gfxProfiles ?? []).map((x) => x.id)]);
    p.settings.gfxProfiles = [...(p.settings.gfxProfiles ?? []), { id, label: name, types: [] }];
    p.settings.gfxCategories = id;
    p.settings.gfxTypes = [];
    syncGfxColumns(p.categories, p.settings);
    created = id;
  });
  if (!created) {
    toast(`“${name}” is already a GFX profile.`);
    return;
  }
  app.set((s) => ({ sheetCat: 'gfx', gfxSheet: 'all', gfxFilter: [], enabled: s.enabled.includes('gfx') ? s.enabled : ['gfx', ...s.enabled] }));
  void flushSave();
}

/** Drag a category tab in front of another. All and Temp stay where they are. */
export function moveGfxType(id: string, beforeId: string) {
  const list = app.get().project?.settings.gfxTypes;
  if (!list || !reorderGfxTypes(list, id, beforeId)) return;
  updateProject((p) => {
    const next = reorderGfxTypes(p.settings.gfxTypes ?? [], id, beforeId);
    if (!next) return;
    p.settings.gfxTypes = next;
    syncGfxColumns(p.categories, p.settings);
  });
  void flushSave();
}

/** Add a project GFX category. It lands at the end until it is dragged. */
export function addGfxType(label: string) {
  const name = label.trim();
  if (!name) return;
  if (name.toLowerCase() === 'temp' || name.toLowerCase() === 'all') {
    toast(`“${name}” is already a tab.`);
    return;
  }
  let added = false;
  let duplicate = false;
  updateProject((p) => {
    if (!p.settings.gfxCategories || p.settings.gfxCategories === 'off') return;
    const list: GfxType[] = p.settings.gfxTypes ?? (p.settings.gfxCategories === 'osos' ? OSOS_GFX_TYPES.map((t) => ({ ...t })) : []);
    if (list.some((t) => t.label.toLowerCase() === name.toLowerCase())) {
      duplicate = true;
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'type';
    const id = list.some((t) => t.id === slug) ? `${slug}-${list.length + 1}` : slug;
    p.settings.gfxTypes = [...list, { id, label: name, short: name }];
    syncGfxColumns(p.categories, p.settings);
    added = true;
  });
  if (duplicate) toast(`“${name}” is already a GFX category.`);
  else if (added) void flushSave();
}

export function toggleGfxFilter(id: string) {
  app.set((s) => {
    const has = s.gfxFilter.includes(id);
    return { gfxFilter: has ? s.gfxFilter.filter((x) => x !== id) : [...s.gfxFilter, id] };
  });
}

/** Add a subtitle profile from a rule file and turn it on. */
export function addSubtitleProfile(label: string, config: import('../core/proofread/osos').OsosConfig) {
  const name = label.trim();
  if (!name) return;
  if (name.toLowerCase() === 'off' || name.toLowerCase() === 'osos subs') {
    toast(`“${name}” can’t be a profile.`);
    return;
  }
  let created = '';
  updateProject((p) => {
    const profiles = p.settings.subtitleProfiles ?? [];
    if (profiles.some((x) => x.label.toLowerCase() === name.toLowerCase())) return;
    const id = profileSlug(name, ['osos', 'off', ...profiles.map((x) => x.id)]);
    p.settings.subtitleProfiles = [...profiles, { id, label: name, config }];
    p.settings.subtitleRules = id;
    created = id;
  });
  if (!created) toast(`“${name}” is already a subtitle profile.`);
  else void flushSave();
}

/** Which subtitle proofreading pass is on. "off" clears it. Does not edit the file. */
export function setSubtitleRules(id: string) {
  updateProject((p) => {
    if (!id || id === 'off') delete p.settings.subtitleRules;
    else p.settings.subtitleRules = id;
  });
  void flushSave();
}

/** Sequence timecode where 00:00:00 in the subtitle file falls. */
export function setSrtZero(versionId: string, catKey: string, tc: string): boolean {
  if (!isTimecode(tc)) return false;
  updateProject((p) => {
    const v = findVersion(p, versionId);
    const slot = v?.slots[catKey];
    if (slot) slot.srtZero = tc.trim();
  });
  reprocess(versionId, [catKey]);
  return true;
}

export function setTrackFilter(versionId: string, catKey: string, tracks: string[]) {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    if (v?.slots[catKey]) v.slots[catKey].trackFilter = tracks.length ? tracks : undefined;
  });
  reprocess(versionId, [catKey]);
}

function finishImport(v: Version, cat: CategoryConfig, slot: CategorySlot, old: Item[], prior: Item[], items: Item[], warnings: string[], stats: CategorySlot['stats']) {
  items = items.filter((it) => !isDismissed(it, v.dismissed?.[cat.key] ?? []));
  // A new version only carries placeholder names (Graphic, Title, …) when a
  // later picture match confirms them. Rebuilding this version keeps them.
  // Subtitles match on the cue text, so a short line is still the same cue.
  if (prior.length) carryValues(prior.filter((it) => !it.manual), items, { looseGenerics: old.length === 0 && cat.source !== 'srt' });
  const manual = prior.filter((it) => it.manual).map((it) => (prior === old ? it : structuredClone(it)));
  applyPrefill(cat, items);
  v.items[cat.key] = [...items, ...manual].sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);
  slot.warnings = warnings;
  slot.stats = stats;
}

/** Import one category in place. Returns an error string, or '' . */
function importOne(d: Project, v: Version, cat: CategoryConfig, base: Version | undefined): string {
  const slot = v.slots[cat.key];
  const old = v.items[cat.key] ?? [];
  const hasFile = cat.source === 'srt' ? !!slot?.srt : !!(slot?.xml || slot?.edl);
  if (!slot || !hasFile) {
    const manual = old.filter((it) => it.manual);
    if (manual.length) v.items[cat.key] = manual;
    else delete v.items[cat.key];
    if (slot) {
      slot.stats = undefined;
      slot.warnings = [];
    }
    return '';
  }
  const prior = old.length ? old : (base?.items[cat.key] ?? []);
  try {
    if (cat.source === 'srt' && slot.srt) {
      const tb = v.rate.timebase;
      let zero = tcToFrames(slot.srtZero ?? '', tb);
      if (!slot.srtZero || Number.isNaN(zero)) {
        const picture = tcToFrames(d.settings.pictureStartTC, tb);
        const first = firstCueFrame(slot.srt.text, v.rate);
        zero = srtZeroFrame(first ?? NaN, Number.isNaN(picture) ? 0 : picture, tb);
        slot.srtZero = framesToTC(zero, tb);
      }
      const built = buildSubtitleItems(slot.srt.text, v.rate, zero);
      finishImport(v, cat, slot, old, prior, built.items, built.warnings, { xmlEvents: 0, edlEvents: 0, matched: 0, items: built.items.length });
      return '';
    }
    const r = importCategory(slot, cat, d.settings);
    finishImport(v, cat, slot, old, prior, r.items, r.warnings, r.stats);
    if (slot.xml) {
      v.rate = r.rate;
      v.seqStartFrame = r.seqStartFrame;
    }
    return '';
  } catch (e) {
    const message = `${cat.label}: ${(e as Error).message}`;
    slot.warnings = [message];
    return message;
  }
}

/**
 * Re-run the import for one version. User values are carried from the items
 * being replaced (re-import) or, for a fresh category, from the baseline version.
 */
export function reprocess(versionId: string, catKeys?: string[]) {
  const s = app.get();
  const p = s.project;
  if (!p) return;
  let failed = '';
  updateProject((d) => {
    const ep = d.episodes.find((e) => e.versions.some((v) => v.id === versionId));
    const v = ep?.versions.find((x) => x.id === versionId);
    if (!ep || !v) return;
    const base = ep.versions.find((x) => x.id === v.carriedFrom) ?? ep.versions[ep.versions.indexOf(v) - 1];
    const rateBefore = v.rate.timebase + (v.rate.ntsc ? 0.1 : 0);
    const ordered = [...d.categories.filter((c) => c.source !== 'srt'), ...d.categories.filter((c) => c.source === 'srt')];
    const run = (cats: CategoryConfig[], force = false) => {
      for (const cat of cats) {
        if (!force && catKeys && !catKeys.includes(cat.key)) continue;
        const err = importOne(d, v, cat, base);
        if (err) failed = err;
      }
    };
    run(ordered);
    const rateNow = v.rate.timebase + (v.rate.ntsc ? 0.1 : 0);
    const srtTouched = !catKeys || ordered.some((c) => c.source === 'srt' && catKeys.includes(c.key));
    if (rateNow !== rateBefore && !srtTouched) run(ordered.filter((c) => c.source === 'srt'), true);
  });
  if (failed) toast(failed, 'error');
}

/** Fill editable columns that have a prefill source (e.g. Cue Library from the ES_ prefix). */
function applyPrefill(cat: CategoryConfig, items: Item[]) {
  for (const col of cat.columns) {
    if (!col.prefill) continue;
    for (const it of items) {
      const cur = it.values[col.id];
      if ((cur === undefined || cur === '' || cur === null) && it.auto[col.prefill]) it.values[col.id] = it.auto[col.prefill] ?? '';
    }
  }
}

export function reprocessAll() {
  const p = app.get().project;
  if (!p) return;
  for (const e of p.episodes) for (const v of e.versions) reprocess(v.id);
}

/** Create a version from dropped files, auto-routing them by name (…GFX…, …CUE…, …ARCHIVAL…). */
export function suggestLabelsFromText(text: string) {
  const m = /<sequence[\s\S]*?<name>([^<]*)<\/name>/.exec(text) ?? /^TITLE:\s*(.*)$/m.exec(text);
  const seq = m?.[1]?.trim();
  return { version: suggestVersionLabel(seq, ''), episode: suggestEpisodeName(seq) };
}

/* ------------------------------------------------------------------ */
/* Item edits                                                          */
/* ------------------------------------------------------------------ */

export function setValue(versionId: string, catKey: string, itemId: string, colId: string, value: CellValue) {
  updateProject((p) => {
    const it = findVersion(p, versionId)?.items[catKey]?.find((i) => i.id === itemId);
    if (it) it.values[colId] = value;
  });
  void flushSave();
}

/** Write screenshot hashes, then fill blank notes from a previous version's matching picture. */
function picturePassPending(p: Project, versionId: string): boolean {
  const ep = p.episodes.find((e) => e.versions.some((v) => v.id === versionId));
  const v = ep?.versions.find((x) => x.id === versionId);
  if (!ep || !v) return false;
  const prev = ep.versions.find((x) => x.id === v.carriedFrom) ?? ep.versions[ep.versions.indexOf(v) - 1];
  if (!prev) return false;
  return p.categories.some((cat) => {
    const donors = (prev.items[cat.key] ?? []).some((i) => i.shotHash && Object.values(i.values).some((val) => val !== '' && val != null && !(Array.isArray(val) && val.length === 0)));
    const waiting = (v.items[cat.key] ?? []).some((i) => i.shotHash && !i.shotCompared);
    return donors && waiting;
  });
}

export function applyShotHashes(versionId: string, hashes: { versionId: string; catKey: string; itemId: string; hash: string }[]): number {
  const current = app.get().project;
  if (!current) return 0;
  if (!hashes.length && !picturePassPending(current, versionId)) return 0;
  let filled = 0;
  updateProject((p) => {
    for (const h of hashes) {
      const it = findVersion(p, h.versionId)?.items[h.catKey]?.find((i) => i.id === h.itemId);
      if (!it) continue;
      if (it.shotHash !== h.hash) delete it.shotCompared;
      it.shotHash = h.hash;
    }
    const ep = p.episodes.find((e) => e.versions.some((v) => v.id === versionId));
    const v = ep?.versions.find((x) => x.id === versionId);
    if (!ep || !v) return;
    const prev = ep.versions.find((x) => x.id === v.carriedFrom) ?? ep.versions[ep.versions.indexOf(v) - 1];
    if (!prev) return;
    for (const cat of p.categories) filled += carryByShot(prev.items[cat.key] ?? [], v.items[cat.key] ?? []);
  });
  if (filled) void flushSave();
  return filled;
}

export function mergeWithNext(versionId: string, catKey: string, itemId: string) {
  updateProject((p) => {
    const list = findVersion(p, versionId)?.items[catKey];
    if (!list) return;
    list.sort((a, b) => a.recIn - b.recIn);
    const i = list.findIndex((x) => x.id === itemId);
    const a = list[i];
    const b = list.slice(i + 1).find((x) => x.kind === a?.kind);
    if (!a || !b) return;
    a.recOut = Math.max(a.recOut, b.recOut);
    a.segments.push(...b.segments);
    a.tracks = [...new Set([...a.tracks, ...b.tracks])].sort();
    for (const [k, v] of Object.entries(b.values)) if (a.values[k] === undefined || a.values[k] === '') a.values[k] = v;
    a.auto.segments = String(a.segments.length);
    list.splice(list.indexOf(b), 1);
  });
}

export function splitItem(versionId: string, catKey: string, itemId: string) {
  updateProject((p) => {
    const list = findVersion(p, versionId)?.items[catKey];
    if (!list) return;
    const i = list.findIndex((x) => x.id === itemId);
    const it = list[i];
    if (!it || it.segments.length < 2) return;
    const parts: Item[] = it.segments.map((seg, n) => ({
      ...structuredClone(it),
      id: n === 0 ? it.id : newId(),
      name: seg.name,
      recIn: seg.recIn,
      recOut: seg.recOut,
      srcIn: seg.srcIn,
      srcOut: seg.srcOut,
      tracks: seg.tracks,
      segments: [seg],
      values: n === 0 ? it.values : {},
      auto: { ...it.auto, segments: '1' },
    }));
    list.splice(i, 1, ...parts);
    list.sort((a, b) => a.recIn - b.recIn);
  });
}

/** Move an entry's in or out. Returns false when the timecode would flip the range. */
export function setItemEdge(versionId: string, catKey: string, itemId: string, which: 'in' | 'out', frame: number): boolean {
  let ok = false;
  updateProject((p) => {
    const v = findVersion(p, versionId);
    const list = v?.items[catKey];
    const it = list?.find((i) => i.id === itemId);
    if (!it || !list) return;
    if (moveEdge(it, which, frame) !== 'ok') return;
    ok = true;
    list.sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);
  });
  if (ok) void flushSave();
  return ok;
}

/** Add a blank entry at the playhead. */
export function addItem(versionId: string, catKey: string): string | null {
  let id: string | null = null;
  updateProject((p) => {
    const v = findVersion(p, versionId);
    const cat = p.categories.find((c) => c.key === catKey);
    if (!v || !cat) return;
    const pic = tcToFrames(p.settings.pictureStartTC, v.rate.timebase);
    const at = playback.get().frame > 0 ? playback.get().frame : Number.isFinite(pic) ? pic : 0;
    const span = Math.max(1, v.rate.timebase * 2);
    id = newId();
    const item: Item = {
      id,
      kind: 'video',
      name: 'New entry',
      groupKey: `manual|${id}`,
      recIn: at,
      recOut: at + span,
      manual: true,
      tracks: [],
      segments: [{ name: 'New entry', recIn: at, recOut: at + span, tracks: [] }],
      auto: {
        clipName: 'New entry',
        ...(cat.grouping === 'music' ? { cueTitle: 'New entry' } : {}),
        ...(cat.extractArchivalIds ? { archivalId: 'New entry' } : {}),
      },
      flags: [],
      values: {},
    };
    const list = v.items[catKey] ?? [];
    list.push(item);
    list.sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);
    v.items[catKey] = list;
  });
  if (id) {
    app.set({ selected: { cat: catKey, id } });
    void flushSave();
  }
  return id;
}

export function renameItem(versionId: string, catKey: string, itemId: string, name: string) {
  const trimmed = name.trim() || 'New entry';
  updateProject((p) => {
    const cat = p.categories.find((c) => c.key === catKey);
    const it = findVersion(p, versionId)?.items[catKey]?.find((i) => i.id === itemId);
    if (!it?.manual || !cat) return;
    it.name = trimmed;
    it.auto.clipName = trimmed;
    it.auto.fileName = trimmed;
    if (cat.grouping === 'music') it.auto.cueTitle = trimmed;
    if (cat.extractArchivalIds) it.auto.archivalId = trimmed;
    if (it.segments[0]) it.segments[0].name = trimmed;
  });
  void flushSave();
}

export function deleteItem(versionId: string, catKey: string, itemId: string) {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    const list = v?.items[catKey];
    if (!v || !list) return;
    const i = list.findIndex((it) => it.id === itemId);
    const it = list[i];
    if (!it) return;
    if (!it.manual) {
      const gone = v.dismissed?.[catKey] ?? [];
      gone.push({
        groupKey: it.groupKey,
        recIn: it.recIn - (it.shift?.in ?? 0),
        recOut: it.recOut - (it.shift?.out ?? 0),
      });
      v.dismissed = { ...v.dismissed, [catKey]: gone };
    }
    list.splice(i, 1);
  });
  void flushSave();
  if (app.get().selected?.cat === catKey && app.get().selected?.id === itemId) app.set({ selected: null });
}

/* ------------------------------------------------------------------ */
/* Evidence files (images / PDFs)                                      */
/* ------------------------------------------------------------------ */

const EVIDENCE_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf)$/i;
const MAX_EVIDENCE = 40 * 1024 * 1024;

export async function addEvidence(versionId: string, catKey: string, itemId: string, colId: string, files: File[]) {
  const p = app.get().project;
  if (!p) return;
  const refs: ImageRef[] = [];
  for (const f of files) {
    if (!EVIDENCE_TYPES.test(f.type)) {
      toast(`${f.name}: only images and PDFs can be attached.`, 'error');
      continue;
    }
    if (f.size > MAX_EVIDENCE) {
      toast(`${f.name} is over 40 MB.`, 'error');
      continue;
    }
    const key = blobKeys.evidence(p.id, newId());
    await store.putBlob(key, f);
    refs.push({ key, name: f.name || 'pasted-image.png', type: f.type });
  }
  if (!refs.length) return;
  updateProject((d) => {
    const it = findVersion(d, versionId)?.items[catKey]?.find((i) => i.id === itemId);
    if (!it) return;
    const cur = Array.isArray(it.values[colId]) ? (it.values[colId] as ImageRef[]) : [];
    it.values[colId] = [...cur, ...refs];
  });
  bumpBlobs();
}

export function removeEvidence(versionId: string, catKey: string, itemId: string, colId: string, key: string) {
  updateProject((d) => {
    const it = findVersion(d, versionId)?.items[catKey]?.find((i) => i.id === itemId);
    if (!it || !Array.isArray(it.values[colId])) return;
    it.values[colId] = (it.values[colId] as ImageRef[]).filter((r) => r.key !== key);
  });
  // The blob may still be referenced by older versions, so it is kept.
}

export function bumpBlobs() {
  app.set((s) => ({ blobRev: s.blobRev + 1 }));
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

type PickerWindow = Window & {
  showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]>;
};
type PermHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
};

export const supportsFileHandles = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window;

type DetectedStart = { tc: string; from: 'file' | 'picture' };

/** Pick a video for a version. Chrome remembers the file; other browsers need it re-picked each session. */
export async function pickVideo(versionId: string, fallbackFile?: File) {
  let file: File | undefined = fallbackFile;
  let hasHandle = false;
  if (!file && supportsFileHandles()) {
    try {
      const [h] = await (window as PickerWindow).showOpenFilePicker!({
        types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.m4v', '.mov', '.webm'] } }],
        excludeAcceptAllOption: false,
        id: 'cutsheet-video',
      });
      await store.putHandle(versionId, h);
      file = await h.getFile();
      hasHandle = true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
      return;
    }
  }
  if (!file) return;
  await ingestVideo(versionId, file, hasHandle, true);
}

/**
 * Read the file's start timecode, then show the video.
 * Choosing a file always applies what we find. Reopening one applies it only
 * when the field is still the project default, so a manual edit stays put.
 * `detectedStartTC === ''` means we already looked and found nothing.
 */
async function ingestVideo(versionId: string, file: File, hasHandle: boolean, choose: boolean) {
  const project = app.get().project;
  const version = project ? findVersion(project, versionId) : undefined;
  const fallback = project?.settings.defaultVideoStartTC ?? '00:59:55:00';
  const current = version?.video?.startTC ?? fallback;
  if (!choose && version?.video?.detectedStartTC !== undefined) {
    attachVideoFile(versionId, file);
    return;
  }

  const rate = version?.rate ?? project?.settings.fallbackRate ?? DEFAULT_RATE;
  const replaceStart = choose || current === fallback;
  app.set({ holdCaptureFor: versionId });
  try {
    let detected: DetectedStart | null = null;
    try {
      const tc = await readContainerStartTC(file);
      if (tc) detected = { tc, from: 'file' };
    } catch {
      detected = null;
    }
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      attachVideoFile(versionId, file);
    };
    let settled = !!detected;
    if (!detected) {
      writeVideoSlot(versionId, file, hasHandle, null, false, replaceStart);
      show();
      try {
        const burned = await readBurnedStartTC(file, rate);
        settled = burned.settled;
        if (burned.tc) detected = { tc: burned.tc, from: 'picture' };
      } catch {
        settled = false;
      }
    }
    writeVideoSlot(versionId, file, hasHandle, detected, settled, replaceStart);
    show();
    if (detected && replaceStart && detected.tc !== current) {
      toast(
        detected.from === 'picture'
          ? `Start timecode set to ${detected.tc} from the burned-in timecode.`
          : `Start timecode set to ${detected.tc} from the file timecode.`,
      );
    }
  } finally {
    app.set({ holdCaptureFor: null });
  }
}

function writeVideoSlot(
  versionId: string,
  file: File,
  hasHandle: boolean,
  detected: DetectedStart | null,
  checked: boolean,
  replaceStart: boolean,
) {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    if (!v) return;
    const prev = v.video;
    const found = detected
      ? { detectedStartTC: detected.tc, detectedFrom: detected.from }
      : checked
        ? { detectedStartTC: '' }
        : prev?.detectedStartTC !== undefined
          ? { detectedStartTC: prev.detectedStartTC, ...(prev.detectedFrom ? { detectedFrom: prev.detectedFrom } : {}) }
          : {};
    v.video = {
      fileName: file.name || prev?.fileName || '',
      startTC: detected && replaceStart ? detected.tc : (prev?.startTC ?? p.settings.defaultVideoStartTC),
      hasHandle,
      ...found,
    };
  });
}

function attachVideoFile(versionId: string, file: File) {
  if (/\.mov$/i.test(file.name) || /prores|quicktime/i.test(file.type)) {
    toast('If this is ProRes it will not play in Chrome — export an H.264 MP4 offline instead.', 'info');
  }
  const urls = { ...app.get().videoUrls };
  if (urls[versionId]) URL.revokeObjectURL(urls[versionId]);
  urls[versionId] = URL.createObjectURL(file);
  app.set({ videoUrls: urls });
}

/**
 * Point a version at a video that is already hosted with the site.
 * A start timecode in the call is used as-is. Otherwise the file is read once.
 */
export async function showHostedVideo(versionId: string, url: string, fileName: string, startTC?: string) {
  const project = app.get().project;
  const version = project ? findVersion(project, versionId) : undefined;
  if (!version) return;

  const given = startTC && isTimecode(startTC) ? startTC : '';
  const known = version.video?.fileName === fileName && version.video.detectedStartTC !== undefined;
  const detect = !given && !known;

  const urls = { ...app.get().videoUrls };
  const prev = urls[versionId];
  if (prev && prev !== url && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
  urls[versionId] = url;
  app.set({ videoUrls: urls, ...(detect ? { holdCaptureFor: versionId } : {}) });

  if (given) {
    updateProject((p) => {
      const v = findVersion(p, versionId);
      if (v) v.video = { ...(v.video ?? { fileName }), fileName, startTC: given, hasHandle: false };
    });
    return;
  }
  if (!detect) return;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const file = new File([await res.blob()], fileName, { type: res.headers.get('content-type') || 'video/mp4' });
    let detected: DetectedStart | null = null;
    try {
      const tc = await readContainerStartTC(file);
      if (tc) detected = { tc, from: 'file' };
    } catch {
      detected = null;
    }
    if (!detected) {
      try {
        const burned = await readBurnedStartTC(file, version.rate);
        if (burned.tc) detected = { tc: burned.tc, from: 'picture' };
        writeVideoSlot(versionId, file, false, detected, burned.settled, true);
        return;
      } catch {
        /* keep the picture up even if the timecode cannot be read */
      }
    }
    writeVideoSlot(versionId, file, false, detected, true, true);
  } finally {
    if (app.get().holdCaptureFor === versionId) app.set({ holdCaptureFor: null });
  }
}

/** Load a remembered video without prompting, if Chrome still has permission. */
export async function autoConnectVideo(versionId: string) {
  if (app.get().videoUrls[versionId]) return;
  const v = findVersion(app.get().project!, versionId);
  if (!v?.video?.hasHandle) return;
  try {
    const h = (await store.getHandle(versionId)) as PermHandle | undefined;
    if (!h) return;
    const perm = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (perm === 'granted') await ingestVideo(versionId, await h.getFile(), true, false);
  } catch {
    /* file moved or permission gone: user can reconnect */
  }
}

/** Reconnect a remembered video (needs a click for the permission prompt). */
export async function reconnectVideo(versionId: string): Promise<boolean> {
  try {
    const h = (await store.getHandle(versionId)) as PermHandle | undefined;
    if (!h) return false;
    const perm = (await h.requestPermission?.({ mode: 'read' })) ?? 'granted';
    if (perm !== 'granted') return false;
    await ingestVideo(versionId, await h.getFile(), true, false);
    return true;
  } catch (e) {
    toast(`Could not open the video: ${(e as Error).message}. Pick it again.`, 'error');
    return false;
  }
}

export function setVideoStartTC(versionId: string, tc: string) {
  updateProject((p) => {
    const v = findVersion(p, versionId);
    if (v) v.video = { ...(v.video ?? { fileName: '' }), startTC: tc };
  });
}

/* ------------------------------------------------------------------ */
/* Categories, settings, templates                                     */
/* ------------------------------------------------------------------ */

export function updateCategories(fn: (cats: CategoryConfig[]) => void) {
  updateProject((p) => fn(p.categories));
  const keys = app.get().project?.categories.map((c) => c.key) ?? [];
  app.set((s) => ({ enabled: s.enabled.filter((k) => keys.includes(k)) }));
}

export async function saveTemplate(name: string) {
  const p = app.get().project;
  if (!p) return;
  await store.saveTemplate({ id: newId(), name, categories: structuredClone(p.categories), createdAt: new Date().toISOString() });
  toast(`Saved column template “${name}”.`);
}

export function applyTemplate(t: ColumnTemplate) {
  updateProject((p) => {
    p.categories = structuredClone(t.categories);
  });
  app.set({ enabled: t.categories.map((c) => c.key) });
  reprocessAll();
}

export function toggleCategory(key: string) {
  app.set((s) => {
    const on = s.enabled.includes(key);
    const order = s.project?.categories.map((c) => c.key) ?? [];
    const next = on ? s.enabled.filter((k) => k !== key) : [...s.enabled, key];
    return { enabled: order.filter((k) => next.includes(k)) };
  });
}

export function select(cat: string, id: string | null) {
  app.set({ selected: id ? { cat, id } : null });
}
