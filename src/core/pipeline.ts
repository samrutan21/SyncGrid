import { looseName } from './merge';
import { tcToFrames } from './timecode';
import { extractArchivalId, fileNameOf, normalizeCue, stripExtension } from './naming';
import type { AutoField, CategoryConfig, Item, ProjectSettings, TimelineEvent } from './types';

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Is this clip something we never track (black video, slugs, mattes ...)? */
export function isIgnored(e: TimelineEvent, settings: ProjectSettings): boolean {
  const n = stripExtension(e.name).trim().toLowerCase();
  for (const raw of settings.ignoreClips) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (n === p || n.startsWith(`${p} `)) return true;
    if (e.isGenerator && n.includes(p)) return true;
  }
  return false;
}

/**
 * Turn merged timeline events into tracker items for one category:
 * filter, extract metadata, then group according to the category rules.
 */
export function buildItems(
  events: TimelineEvent[],
  category: CategoryConfig,
  settings: ProjectSettings,
): Item[] {
  const letters = Object.keys(settings.sourceTypeLetters);
  const usable = events
    .filter((e) => e.recOut > e.recIn && !isIgnored(e, settings))
    .sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);

  const toItem = (e: TimelineEvent): Item => {
    const auto: Partial<Record<AutoField, string>> = {
      clipName: e.name,
      fileName: fileNameOf(e.name, e.filePath),
      filePath: e.filePath ?? '',
      resolution: e.width && e.height ? `${e.width}×${e.height}` : '',
      tracks: e.tracks.join(', '),
      logNote: [e.logNote, e.description].filter(Boolean).join(' · '),
      reel: e.reel ?? '',
    };
    let groupKey = `${e.kind}|${looseName(stripExtension(e.name))}`;

    if (category.grouping === 'music') {
      const cue = normalizeCue(e.name, settings.musicStripWords, settings.libraryPrefixes);
      auto.cueTitle = cue.title;
      auto.artist = cue.artist ?? '';
      auto.library = cue.library ?? '';
      groupKey = `${e.kind}|${cue.key}`;
    }

    if (category.extractArchivalIds) {
      const id = extractArchivalId(e.name, settings.archivalPrefixes, letters);
      if (id) {
        auto.archivalId = id.id;
        auto.sourceType = settings.sourceTypeLetters[id.letter] ?? id.letter;
        groupKey = `${e.kind}|${id.id.toLowerCase()}`;
      } else {
        auto.archivalId = '';
        auto.sourceType = '';
      }
      const stillById = /still/i.test(auto.sourceType ?? '');
      const stillByName = /\.(png|jpe?g|tiff?|psd|gif|heic|webp|bmp)$/i.test(e.name);
      auto.usage = e.kind === 'audio' ? 'Audio' : stillById || stillByName ? 'Still' : 'Video';
    }

    return {
      id: newId(),
      kind: e.kind,
      name: e.name,
      groupKey,
      recIn: e.recIn,
      recOut: e.recOut,
      srcIn: e.srcIn,
      srcOut: e.srcOut,
      srcInFrames: e.srcInFrames,
      srcOutFrames: e.srcOutFrames,
      srcTimebase: e.srcTimebase,
      reel: e.reel,
      tracks: [...e.tracks],
      segments: [
        { name: e.name, recIn: e.recIn, recOut: e.recOut, srcIn: e.srcIn, srcOut: e.srcOut, tracks: [...e.tracks] },
      ],
      auto,
      flags: [...new Set(e.flags ?? [])],
      values: {},
    };
  };

  const raw = usable.map(toItem);
  fillSourceFrames(raw);
  if (category.grouping === 'none') return raw;

  // Group: same identity + touching/overlapping (within gapFrames) = one entry.
  const out: Item[] = [];
  const open = new Map<string, Item>();
  for (const it of raw) {
    const last = open.get(it.groupKey);
    if (last && it.recIn - last.recOut <= category.gapFrames) {
      if (it.recOut > last.recOut) {
        last.recOut = it.recOut;
        last.srcOut = it.srcOut;
        last.srcOutFrames = it.srcOutFrames;
      }
      last.segments.push(...it.segments);
      last.tracks = [...new Set([...last.tracks, ...it.tracks])].sort();
      last.flags = [...new Set([...last.flags, ...it.flags])];
      for (const [k, v] of Object.entries(it.auto) as [AutoField, string][]) {
        if (!last.auto[k] && v) last.auto[k] = v;
      }
      if (category.grouping === 'music' && it.auto.logNote && !last.auto.logNote?.includes(it.auto.logNote)) {
        last.auto.logNote = [last.auto.logNote, it.auto.logNote].filter(Boolean).join(' · ');
      }
      continue;
    }
    open.set(it.groupKey, it);
    out.push(it);
  }
  for (const it of out) {
    it.auto.segments = String(it.segments.length);
    it.auto.tracks = it.tracks.join(', ');
  }
  return out;
}

/**
 * EDL-only items have source TC text but no frame numbers. Estimate each
 * clip's source timebase from the highest frame field seen for that clip so
 * overlap checks (archival repeats, version matching) still work.
 */
function fillSourceFrames(items: Item[]): void {
  const byName = new Map<string, Item[]>();
  for (const it of items) {
    if (it.srcInFrames !== undefined || !it.srcIn || !it.srcOut) continue;
    const k = looseName(it.name);
    byName.set(k, [...(byName.get(k) ?? []), it]);
  }
  for (const list of byName.values()) {
    let maxFF = 0;
    for (const it of list) {
      for (const tc of [it.srcIn, it.srcOut]) {
        const ff = Number((tc ?? '').split(/[:;]/)[3]);
        if (Number.isFinite(ff)) maxFF = Math.max(maxFF, ff);
      }
    }
    const tb = maxFF >= 30 ? 60 : maxFF >= 25 ? 30 : maxFF >= 24 ? 25 : 24;
    for (const it of list) {
      const a = tcToFrames(it.srcIn ?? '', tb, false);
      const b = tcToFrames(it.srcOut ?? '', tb, false);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        it.srcInFrames = a;
        it.srcOutFrames = b;
        it.srcTimebase = tb;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Repeats                                                             */
/* ------------------------------------------------------------------ */

export interface RepeatInfo {
  count: number;
  /** Item ids of every use, in timeline order (including this one). */
  ids: string[];
}

/**
 * GFX / music: the same graphic or cue used again later is a repeat.
 * Archival: the same source moment (overlapping source range, same media kind)
 * used more than once. Reusing different parts of one long clip is normal and
 * is not flagged.
 */
export function findRepeats(items: Item[], category: CategoryConfig, minOverlapSeconds = 1): Map<string, RepeatInfo> {
  const result = new Map<string, RepeatInfo>();
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const g = groups.get(it.groupKey) ?? [];
    g.push(it);
    groups.set(it.groupKey, g);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    if (category.grouping !== 'none') {
      const ids = list.map((i) => i.id);
      for (const it of list) result.set(it.id, { count: list.length, ids });
      continue;
    }
    // Archival: cluster by overlapping source ranges.
    const n = list.length;
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const A = list[a];
        const B = list[b];
        if (A.srcInFrames === undefined || B.srcInFrames === undefined) continue;
        if (A.srcOutFrames === undefined || B.srcOutFrames === undefined) continue;
        const tb = A.srcTimebase ?? 30;
        const overlap = Math.min(A.srcOutFrames, B.srcOutFrames) - Math.max(A.srcInFrames, B.srcInFrames);
        if (overlap >= minOverlapSeconds * tb) parent[find(a)] = find(b);
      }
    }
    const clusters = new Map<number, Item[]>();
    list.forEach((it, i) => {
      const r = find(i);
      clusters.set(r, [...(clusters.get(r) ?? []), it]);
    });
    for (const c of clusters.values()) {
      if (c.length < 2) continue;
      const ids = c.sort((x, y) => x.recIn - y.recIn).map((i) => i.id);
      for (const it of c) result.set(it.id, { count: c.length, ids });
    }
  }
  return result;
}
