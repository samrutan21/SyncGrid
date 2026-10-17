import { addEpisode, addVersion, createProject, setSlotText, toast, updateProject } from './state/app';

/**
 * Optional demo project. Files live in public/sample-data — delete that folder
 * and the "Load sample project" button disappears.
 */

interface Manifest {
  project: string;
  episode: string;
  archivalPrefixes: string[];
  versions: { label: string; slots: Record<string, { xml?: string; edl?: string }> }[];
}

const BASE = 'sample-data/';

export async function sampleAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}manifest.json`, { cache: 'no-store' });
    if (!r.ok) return false;
    const j = (await r.json()) as Partial<Manifest>;
    return Array.isArray(j.versions);
  } catch {
    return false;
  }
}

export async function loadSampleProject() {
  const m = (await (await fetch(`${BASE}manifest.json`)).json()) as Manifest;
  await createProject(m.project);
  updateProject((p) => {
    p.settings.archivalPrefixes = m.archivalPrefixes;
  });
  const ep = addEpisode(m.episode);
  for (const v of m.versions) {
    const vid = addVersion(ep, v.label);
    for (const [cat, files] of Object.entries(v.slots)) {
      for (const which of ['xml', 'edl'] as const) {
        const name = files[which];
        if (!name) continue;
        const r = await fetch(BASE + encodeURIComponent(name));
        if (!r.ok) continue;
        await setSlotText(vid, cat, which, name, await r.text());
      }
    }
  }
  toast('Sample project loaded. Load an offline video on each version to see screenshots.');
}
