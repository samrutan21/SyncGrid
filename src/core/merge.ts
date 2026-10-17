import type { ParsedTimeline, TimelineEvent } from './types';

/** Lowercase, accent-free, alphanumeric only. Survives EDL encoding damage. */
export function looseName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/�/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const sortTracks = (t: string[]) =>
  [...new Set(t)].sort((a, b) => a[0].localeCompare(b[0]) || parseInt(a.slice(1)) - parseInt(b.slice(1)));

/**
 * Collapse identical events stacked on several tracks/channels (stereo pairs,
 * dual mono, exploded channels) into one event with all track labels.
 * Same clip + same record in/out + same source in = one use.
 */
export function collapseStacked(events: TimelineEvent[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const byKey = new Map<string, TimelineEvent>();
  for (const e of events) {
    const key = [e.kind, looseName(e.name), e.recIn, e.recOut, e.srcIn ?? '', e.srcInFrames ?? ''].join('|');
    const hit = byKey.get(key);
    if (hit) {
      hit.tracks = sortTracks([...hit.tracks, ...e.tracks]);
      if (e.eventNumbers) hit.eventNumbers = [...(hit.eventNumbers ?? []), ...e.eventNumbers];
      continue;
    }
    const copy: TimelineEvent = { ...e, tracks: [...e.tracks], flags: [...(e.flags ?? [])] };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

export interface MergeResult {
  events: TimelineEvent[];
  warnings: string[];
  stats: { xmlEvents: number; edlEvents: number; matched: number };
}

/**
 * Merge an XML and an EDL exported from the same sequence.
 * Events are matched on record timecode (±1 frame) and media kind, with the
 * clip name as a tie-breaker. XML supplies names, paths and resolution; the
 * EDL supplies source timecode, reel and channel numbers.
 */
export function mergeTimelines(xml?: ParsedTimeline, edl?: ParsedTimeline): MergeResult {
  const warnings: string[] = [];
  const x = xml ? collapseStacked(xml.events) : [];
  const e = edl ? collapseStacked(edl.events) : [];

  if (!xml || !edl) {
    return {
      events: (xml ? x : e).map((ev) => ({ ...ev })),
      warnings,
      stats: { xmlEvents: x.length, edlEvents: e.length, matched: 0 },
    };
  }

  const used = new Set<number>();
  const merged: TimelineEvent[] = [];
  let matched = 0;

  for (const xe of x) {
    let best = -1;
    let bestScore = -1;
    const xn = looseName(xe.name);
    for (let i = 0; i < e.length; i++) {
      if (used.has(i)) continue;
      const ee = e[i];
      if (ee.kind !== xe.kind) continue;
      if (Math.abs(ee.recIn - xe.recIn) > 1) continue;
      const en = looseName(ee.name);
      let score = 0;
      if (en && xn && en === xn) score += 4;
      else if (en && xn && (xn.startsWith(en) || en.startsWith(xn) || similar(en, xn))) score += 3;
      if (Math.abs(ee.recOut - xe.recOut) <= 1) score += 2;
      if (ee.recIn === xe.recIn) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 3) {
      used.add(best);
      matched++;
      const ee = e[best];
      const flags = [...(xe.flags ?? [])];
      if (Math.abs(ee.recOut - xe.recOut) > 1) {
        flags.push('Out point differs between XML and EDL');
      }
      merged.push({
        ...xe,
        origin: 'both',
        srcIn: ee.srcIn ?? xe.srcIn,
        srcOut: ee.srcOut ?? xe.srcOut,
        reel: ee.reel,
        // XML track numbers match the editor's timeline; EDL channels don't.
        tracks: xe.tracks,
        eventNumbers: ee.eventNumbers,
        flags,
      });
    } else {
      merged.push({ ...xe, flags: [...(xe.flags ?? []), 'Only in XML — not found in the EDL'] });
    }
  }
  e.forEach((ee, i) => {
    if (!used.has(i)) merged.push({ ...ee, flags: [...(ee.flags ?? []), 'Only in EDL — not found in the XML'] });
  });

  merged.sort((a, b) => a.recIn - b.recIn || (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1));

  const denom = Math.min(x.length, e.length);
  if (denom > 0 && matched / denom < 0.5) {
    warnings.push(
      `Only ${matched} of ${denom} events line up between the XML and EDL. Were they exported from the same sequence at the same time?`,
    );
  }
  return { events: merged, warnings, stats: { xmlEvents: x.length, edlEvents: e.length, matched } };
}

/** Cheap similarity: share a long common prefix (EDLs truncate long names). */
function similar(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length, 24);
  return n >= 8 && a.slice(0, n) === b.slice(0, n);
}
