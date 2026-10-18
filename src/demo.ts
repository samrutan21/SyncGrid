import {
  addEpisode,
  addVersion,
  app,
  createProject,
  deleteProject,
  flushSave,
  openProject,
  safeGet,
  safeSet,
  setGfxCategories,
  setSlotText,
  setSubtitleRules,
  showHostedVideo,
  updateProject,
} from './state/app';

/**
 * Public-demo seed. Runs only when the site is built with VITE_DEMO=1.
 * Files live in public/demo and are the only episode material that ships.
 */

interface DemoSlot {
  xml?: string;
  edl?: string;
  srt?: string;
  video?: string;
  startTC?: string;
}

interface DemoManifest {
  revision?: number;
  project?: string;
  episode?: string;
  video?: string;
  startTC?: string;
  /** Sequence timecode of picture start. An SRT that begins at 00:00:00 uses this. */
  pictureStartTC?: string;
  archivalPrefixes?: string[];
  subtitleRules?: string;
  gfxCategories?: string;
  versions?: { label: string; slots?: Record<string, DemoSlot>; video?: string; startTC?: string }[];
}

const KEY = 'cutsheet:demo';

export async function openDemo(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  let manifest: DemoManifest;
  try {
    const res = await fetch(`${base}demo/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    manifest = (await res.json()) as DemoManifest;
  } catch {
    return;
  }
  const versions = manifest.versions ?? [];
  if (!versions.length) return;

  const revision = String(manifest.revision ?? 1);
  const saved = safeGet(KEY);
  const split = saved?.indexOf('\t') ?? -1;
  const prevRev = split >= 0 ? saved!.slice(0, split) : '';
  const prevId = split >= 0 ? saved!.slice(split + 1) : '';
  const have = prevRev === revision && !!prevId && app.get().projects.some((p) => p.id === prevId);

  if (have) {
    if (app.get().project?.id !== prevId) await openProject(prevId);
  } else {
    if (prevId) await deleteProject(prevId);
    await createProject(manifest.project?.trim() || 'Demo');
    if (manifest.archivalPrefixes?.length || manifest.pictureStartTC || manifest.startTC) {
      updateProject((p) => {
        if (manifest.archivalPrefixes?.length) p.settings.archivalPrefixes = manifest.archivalPrefixes;
        if (manifest.pictureStartTC) p.settings.pictureStartTC = manifest.pictureStartTC;
        if (manifest.startTC) p.settings.defaultVideoStartTC = manifest.startTC;
      });
    }
    if (manifest.subtitleRules) setSubtitleRules(manifest.subtitleRules);
    if (manifest.gfxCategories) setGfxCategories(manifest.gfxCategories);
    const episodeId = addEpisode(manifest.episode?.trim() || 'Episode 1');
    for (const version of versions) {
      const versionId = addVersion(episodeId, version.label || 'Version 1');
      for (const [cat, files] of Object.entries(version.slots ?? {})) {
        for (const which of ['xml', 'edl', 'srt'] as const) {
          const name = files[which];
          if (!name) continue;
          const file = await fetch(`${base}demo/${encodeURIComponent(name)}`);
          if (!file.ok) continue;
          await setSlotText(versionId, cat, which, name, await file.text());
        }
      }
    }
    await flushSave();
    const id = app.get().project?.id;
    if (id) safeSet(KEY, `${revision}\t${id}`);
  }

  const project = app.get().project;
  if (!project) return;
  for (const episode of project.episodes) {
    for (const version of episode.versions) {
      const spec = versions.find((v) => v.label === version.label) ?? versions[0];
      const name = spec?.video || manifest.video;
      if (!name) continue;
      await showHostedVideo(version.id, `${base}demo/${encodeURIComponent(name)}`, name, spec?.startTC || manifest.startTC);
    }
  }
}
