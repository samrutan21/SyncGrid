import { looseName } from './merge';
import { stripExtension } from './naming';
import { hashDistance } from './shotHash';
import { deltaLabel } from './timecode';
import type { CellValue, Item } from './types';

/**
 * Version matching and change reports.
 *
 * Items are matched within the same identity (groupKey: archival ID, cue,
 * graphic name). Inside an identity, pairs are chosen by source overlap first
 * (exact for archival), then by order of use, then by duration and position.
 */

export type ChangeKind = 'new' | 'changed' | 'shifted' | 'same';

export interface ItemChange {
  kind: ChangeKind;
  prevId?: string;
  moved: number;
  durationDelta: number;
  sourceChanged: boolean;
  summary: string[];
}

export interface VersionDiff {
  changes: Map<string, ItemChange>;
  removed: Item[];
  counts: Record<ChangeKind | 'removed', number>;
}

const dur = (i: Item) => i.recOut - i.recIn;

export function matchItems(prev: Item[], next: Item[]): Map<string, Item> {
  const pairs = new Map<string, Item>();
  const groupsP = new Map<string, Item[]>();
  const groupsN = new Map<string, Item[]>();
  for (const p of prev) groupsP.set(p.groupKey, [...(groupsP.get(p.groupKey) ?? []), p]);
  for (const n of next) groupsN.set(n.groupKey, [...(groupsN.get(n.groupKey) ?? []), n]);

  for (const [key, ns] of groupsN) {
    const ps = groupsP.get(key);
    if (!ps) continue;
    const pSorted = [...ps].sort((a, b) => a.recIn - b.recIn);
    const nSorted = [...ns].sort((a, b) => a.recIn - b.recIn);
    type Cand = { p: Item; n: Item; overlap: number; order: number; durD: number; posD: number };
    const cands: Cand[] = [];
    pSorted.forEach((p, pi) =>
      nSorted.forEach((n, ni) => {
        let overlap = 0;
        if (
          p.srcInFrames !== undefined && p.srcOutFrames !== undefined &&
          n.srcInFrames !== undefined && n.srcOutFrames !== undefined
        ) {
          overlap = Math.max(0, Math.min(p.srcOutFrames, n.srcOutFrames) - Math.max(p.srcInFrames, n.srcInFrames));
        }
        cands.push({
          p,
          n,
          overlap,
          order: Math.abs(pi - ni),
          durD: Math.abs(dur(p) - dur(n)),
          posD: Math.abs(p.recIn - n.recIn),
        });
      }),
    );
    // Archival with real source ranges: require overlap when any exists.
    const anyOverlap = cands.some((c) => c.overlap > 0);
    cands.sort((a, b) => b.overlap - a.overlap || a.order - b.order || a.durD - b.durD || a.posD - b.posD);
    const usedP = new Set<string>();
    const usedN = new Set<string>();
    for (const c of cands) {
      if (usedP.has(c.p.id) || usedN.has(c.n.id)) continue;
      if (anyOverlap && c.overlap === 0 && isSourceSpecific(c.p) && isSourceSpecific(c.n)) continue;
      usedP.add(c.p.id);
      usedN.add(c.n.id);
      pairs.set(c.n.id, c.p);
    }
  }
  return pairs;
}

/** Items whose source range identifies the use (archival cuts), as opposed to stills/cues. */
function isSourceSpecific(i: Item): boolean {
  return i.segments.length === 1 && i.srcInFrames !== undefined && i.srcOutFrames !== undefined && i.srcOutFrames - i.srcInFrames > 0;
}

export function diffItems(prev: Item[], next: Item[], timebase: number): VersionDiff {
  const pairs = matchItems(prev, next);
  const changes = new Map<string, ItemChange>();
  const counts = { new: 0, changed: 0, shifted: 0, same: 0, removed: 0 };
  const matchedPrev = new Set<string>();

  for (const n of next) {
    const p = pairs.get(n.id);
    if (!p) {
      changes.set(n.id, { kind: 'new', moved: 0, durationDelta: 0, sourceChanged: false, summary: ['New in this version'] });
      counts.new++;
      continue;
    }
    matchedPrev.add(p.id);
    const moved = n.recIn - p.recIn;
    const durationDelta = dur(n) - dur(p);
    const sourceChanged =
      n.segments.length === 1 && p.segments.length === 1 && !!n.srcIn && !!p.srcIn && (n.srcIn !== p.srcIn || n.srcOut !== p.srcOut);
    const summary: string[] = [];
    if (durationDelta) summary.push(`Duration ${deltaLabel(durationDelta, timebase)}`);
    if (sourceChanged) summary.push('Source in/out changed');
    if (n.segments.length !== p.segments.length) summary.push(`Pieces ${p.segments.length} → ${n.segments.length}`);
    const contentChanged = summary.length > 0;
    if (moved) summary.unshift(`${contentChanged ? 'Moved' : 'Shifted'} ${deltaLabel(moved, timebase)}`);
    const kind: ChangeKind = contentChanged ? 'changed' : moved ? 'shifted' : 'same';
    counts[kind]++;
    changes.set(n.id, { kind, prevId: p.id, moved, durationDelta, sourceChanged, summary });
  }
  const removed = prev.filter((p) => !matchedPrev.has(p.id));
  counts.removed = removed.length;
  return { changes, removed, counts };
}

/**
 * Placeholder clip names. A lot of temp graphics are all called "Graphic",
 * so pairing them by order would paste one graphic's text onto another.
 */
const GENERIC_NAMES = new Set([
  'graphic',
  'graphics',
  'title',
  'text',
  'shape',
  'mogrt',
  'motiongraphic',
  'lowerthird',
  'still',
  'video',
  'clip',
  'media',
  'image',
  'newtitle',
  'untitled',
  'solid',
  'colormatte',
  'adjustmentlayer',
  'placeholder',
]);

export function isAmbiguousName(name: string): boolean {
  const n = looseName(stripExtension(name)).replace(/\d+$/, '');
  return n === '' || GENERIC_NAMES.has(n);
}

/**
 * Copy user-entered values (notes, links, statuses, evidence) from the
 * previous version's items onto their matches in the new version.
 * `looseGenerics` is for a new version: a shared placeholder name is not
 * enough, so those rows stay blank until a screenshot confirms them.
 * Rebuilding the version you are already editing leaves it off, so the
 * notes on that cut are not thrown away.
 */
export function carryValues(prev: Item[], next: Item[], opts?: { looseGenerics?: boolean }): number {
  const pairs = matchItems(prev, next);
  const loose = opts?.looseGenerics === true;
  let n = 0;
  for (const it of next) {
    const p = pairs.get(it.id);
    if (!p) continue;
    if (loose && isAmbiguousName(it.name)) continue;
    if (Object.keys(p.values).length) {
      it.values = structuredClone(p.values);
      n++;
    }
    if (p.shift && (p.shift.in || p.shift.out)) {
      it.recIn += p.shift.in;
      it.recOut = Math.max(it.recIn + 1, it.recOut + p.shift.out);
      it.shift = { in: p.shift.in, out: p.shift.out };
      if (it.segments.length) {
        it.segments[0].recIn += p.shift.in;
        it.segments[it.segments.length - 1].recOut += p.shift.out;
      }
    }
    // A chosen frame rides along with the cut, including a hand-applied shift.
    if (p.shotFrame !== undefined) it.shotFrame = p.shotFrame + (it.recIn - p.recIn);
  }
  return n;
}

const EMPTY = (v: CellValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function fillEmpty(dst: Item, src: Item): boolean {
  let wrote = false;
  for (const [k, v] of Object.entries(src.values)) {
    if (EMPTY(v) || !EMPTY(dst.values[k])) continue;
    dst.values[k] = structuredClone(v);
    wrote = true;
  }
  return wrote;
}

/**
 * Fill blank fields when a screenshot is the same picture as a previous
 * item. Used for placeholder names, and for a graphic that was renamed.
 * A match has to be clearly closer than the runner-up, and each previous
 * item is used at most once. Fields someone already typed are left alone.
 * Returns how many items received something.
 */
export function carryByShot(prev: Item[], next: Item[]): number {
  const CLOSE = 10;
  const GAP = 6;
  const namePairs = matchItems(
    prev.filter((p) => !isAmbiguousName(p.name)),
    next.filter((n) => !isAmbiguousName(n.name)),
  );
  const used = new Set<string>([...namePairs.values()].map((p) => p.id));
  const donors = prev.filter((p) => p.shotHash && !used.has(p.id) && Object.values(p.values).some((v) => !EMPTY(v)));
  if (!donors.length) return 0;
  let n = 0;
  for (const it of next) {
    if (namePairs.has(it.id) || it.shotCompared || !it.shotHash) continue;
    let best: Item | null = null;
    let bestD = 65;
    let second = 65;
    for (const p of donors) {
      if (used.has(p.id)) continue;
      const d = hashDistance(p.shotHash!, it.shotHash!);
      if (d === null) continue;
      if (d < bestD) {
        second = bestD;
        best = p;
        bestD = d;
      } else if (d < second) second = d;
    }
    it.shotCompared = true;
    if (!best || bestD > CLOSE || second - bestD < GAP) continue;
    if (fillEmpty(it, best)) n++;
    used.add(best.id);
  }
  return n;
}
