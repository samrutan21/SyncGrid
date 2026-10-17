import { canDropFrame, framesToTC, type Rate } from '../timecode';
import type { MediaKind, ParsedTimeline, TimelineEvent, TrackInfo } from '../types';

/**
 * Final Cut Pro 7 / Premiere Pro XML (xmeml) parser.
 *
 * Reads the first sequence, every clip on every video/audio track, resolves
 * shared <file id="..."/> references, and handles clips whose start/end are -1
 * because they sit inside a transition (cross fades on audio are common).
 * The browser's DOMParser never fetches external entities, so untrusted XML
 * cannot reach the network or the file system.
 */

const MAX_BYTES = 80 * 1024 * 1024;

interface FileInfo {
  name?: string;
  pathurl?: string;
  timebase?: number;
  ntsc?: boolean;
  tcFrame?: number;
  tcDF?: boolean;
  width?: number;
  height?: number;
}

const kids = (el: Element | null | undefined, tag: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.tagName === tag) : [];
const kid = (el: Element | null | undefined, tag: string): Element | undefined => kids(el, tag)[0];
const txt = (el: Element | null | undefined, tag: string): string | undefined => {
  const k = kid(el, tag);
  return k ? (k.textContent ?? '').trim() : undefined;
};
const num = (el: Element | null | undefined, tag: string): number | undefined => {
  const v = txt(el, tag);
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const rateOf = (el: Element | null | undefined): Rate | undefined => {
  const r = kid(el, 'rate');
  const tb = num(r, 'timebase');
  if (!tb) return undefined;
  return { timebase: tb, ntsc: (txt(r, 'ntsc') ?? '').toUpperCase() === 'TRUE' };
};

export function parseXMEML(text: string, domParser?: DOMParser): ParsedTimeline {
  if (text.length > MAX_BYTES) throw new Error('XML file is too large (over 80 MB).');
  const parser = domParser ?? new DOMParser();
  // Drop the DOCTYPE: never needed, and keeps entity tricks out entirely.
  const cleaned = text.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/i, '');
  const doc = parser.parseFromString(cleaned, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('This file is not valid XML.');
  }
  const root = doc.documentElement;
  if (root.tagName !== 'xmeml') {
    throw new Error('Not a Premiere/Final Cut 7 XML (xmeml). In Premiere use File → Export → Final Cut Pro XML.');
  }

  const warnings: string[] = [];
  const seq = kid(root, 'sequence') ?? root.getElementsByTagName('sequence')[0];
  if (!seq) throw new Error('No sequence found in this XML.');
  if (root.getElementsByTagName('sequence').length > 1 && !kid(root, 'sequence')) {
    warnings.push('XML contains several sequences — the first one was used.');
  }

  const rate = rateOf(seq) ?? { timebase: 24, ntsc: true };
  const seqTC = kid(seq, 'timecode');
  const startFrame = num(seqTC, 'frame') ?? 0;
  const name = txt(seq, 'name') ?? 'Sequence';

  // Shared file definitions: first occurrence carries the details.
  const files = new Map<string, FileInfo>();
  for (const f of Array.from(doc.getElementsByTagName('file'))) {
    const id = f.getAttribute('id');
    if (!id) continue;
    const existing = files.get(id);
    if (existing && existing.name) continue;
    if (!kid(f, 'name') && !kid(f, 'pathurl')) {
      if (!existing) files.set(id, {});
      continue;
    }
    const r = rateOf(f);
    const tc = kid(f, 'timecode');
    const tcRate = rateOf(tc) ?? r;
    const vchar = kid(kid(kid(f, 'media'), 'video'), 'samplecharacteristics');
    files.set(id, {
      name: txt(f, 'name'),
      pathurl: txt(f, 'pathurl'),
      timebase: tcRate?.timebase ?? r?.timebase,
      ntsc: tcRate?.ntsc ?? r?.ntsc,
      tcFrame: num(tc, 'frame'),
      tcDF: (txt(tc, 'displayformat') ?? '').toUpperCase() === 'DF',
      width: num(vchar, 'width'),
      height: num(vchar, 'height'),
    });
  }

  const events: TimelineEvent[] = [];
  const tracks: TrackInfo[] = [];
  const media = kid(seq, 'media');

  for (const kind of ['video', 'audio'] as MediaKind[]) {
    const trackEls = kids(kid(media, kind), 'track');
    // Premiere "explodes" stereo tracks into one XML track per channel; the
    // currentExplodedTrackIndex attribute lets us recover the real track number.
    let premiereIndex = 0;
    trackEls.forEach((track) => {
      const ex = track.getAttribute('currentExplodedTrackIndex');
      if (ex === null || ex === '0') premiereIndex++;
      const label = `${kind === 'video' ? 'V' : 'A'}${premiereIndex}`;
      const children = Array.from(track.children).filter(
        (c) => c.tagName === 'clipitem' || c.tagName === 'transitionitem' || c.tagName === 'generatoritem',
      );
      let count = 0;
      children.forEach((el, i) => {
        if (el.tagName === 'transitionitem') return;
        if ((txt(el, 'enabled') ?? 'TRUE').toUpperCase() === 'FALSE') return;
        const ev = readClip(el, children, i, kind, label, files, rate, warnings);
        if (ev) {
          events.push(ev);
          count++;
        }
      });
      const existing = tracks.find((t) => t.label === label);
      if (existing) existing.clipCount = Math.max(existing.clipCount, count);
      else if (count) tracks.push({ label, kind, clipCount: count });
    });
  }

  events.sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);
  // Make record frames absolute.
  for (const e of events) {
    e.recIn += startFrame;
    e.recOut += startFrame;
  }

  return { format: 'xml', sequenceName: name, rate, startFrame, events, tracks, warnings };
}

function readClip(
  el: Element,
  siblings: Element[],
  index: number,
  kind: MediaKind,
  track: string,
  files: Map<string, FileInfo>,
  seqRate: Rate,
  warnings: string[],
): TimelineEvent | null {
  const name = txt(el, 'name') ?? 'Untitled';
  const clipRate = rateOf(el) ?? seqRate;
  const inF = num(el, 'in') ?? 0;
  const outF = num(el, 'out') ?? 0;
  const startRaw = num(el, 'start') ?? -1;
  const endRaw = num(el, 'end') ?? -1;
  const len = Math.max(0, outF - inF);

  // A start/end of -1 means the clip edge sits inside a transition. The edit
  // point (what an EDL reports) is the transition's cut point; the clip's media
  // continues under the transition (the cross-fade handle).
  const prevEl = siblings[index - 1];
  const nextEl = siblings[index + 1];
  const prevT = prevEl?.tagName === 'transitionitem' ? prevEl : undefined;
  const nextT = nextEl?.tagName === 'transitionitem' ? nextEl : undefined;

  let recStart: number | undefined = startRaw >= 0 ? startRaw : prevT ? cutPoint(prevT, seqRate) : undefined;
  let recEnd: number | undefined = endRaw >= 0 ? endRaw : nextT ? cutPoint(nextT, seqRate) : undefined;
  if (recStart === undefined && recEnd !== undefined) recStart = recEnd - len;
  if (recEnd === undefined && recStart !== undefined) recEnd = recStart + len;
  if (recStart === undefined || recEnd === undefined) {
    warnings.push(`Could not place "${name}" on ${track} (no start/end).`);
    return null;
  }
  // Where the clip's media (its <in> frame) actually begins on the timeline.
  const mediaStart = startRaw >= 0 ? startRaw : prevT ? (num(prevT, 'start') ?? recStart) : recStart;
  const usedIn = inF + Math.max(0, recStart - mediaStart);
  const usedOut = Math.min(outF, usedIn + (recEnd - recStart));
  const start = recStart;
  const end = recEnd;

  const fileEl = kid(el, 'file');
  const file = fileEl ? files.get(fileEl.getAttribute('id') ?? '') : undefined;
  const isGenerator = el.tagName === 'generatoritem' || (!fileEl && !kid(el, 'sequence'));

  let srcIn: string | undefined;
  let srcOut: string | undefined;
  let srcInFrames: number | undefined;
  let srcOutFrames: number | undefined;
  let srcTimebase: number | undefined;
  if (file && file.timebase) {
    const ftb = file.timebase;
    const ratio = ftb / clipRate.timebase;
    const base = file.tcFrame ?? 0;
    srcInFrames = base + Math.floor(usedIn * ratio + 1e-6);
    srcOutFrames = base + Math.floor(usedOut * ratio + 1e-6);
    srcTimebase = ftb;
    const df = !!file.tcDF && canDropFrame({ timebase: ftb, ntsc: !!file.ntsc });
    srcIn = framesToTC(srcInFrames, ftb, df).replace(/;/g, ':');
    srcOut = framesToTC(srcOutFrames, ftb, df).replace(/;/g, ':');
  }

  const log = kid(el, 'logginginfo');
  let filePath: string | undefined;
  if (file?.pathurl) {
    try {
      filePath = decodeURIComponent(file.pathurl.replace(/^file:\/\/localhost/i, '').replace(/^file:\/\//i, ''));
    } catch {
      filePath = file.pathurl;
    }
  }

  return {
    origin: 'xml',
    kind,
    name,
    recIn: start,
    recOut: end,
    srcIn,
    srcOut,
    srcInFrames,
    srcOutFrames,
    srcTimebase,
    tracks: [track],
    filePath,
    width: file?.width,
    height: file?.height,
    logNote: txt(log, 'lognote') || undefined,
    description: txt(log, 'description') || undefined,
    isGenerator,
    flags: [],
  };
}

/** Premiere ticks per second. */
const TICKS_PER_SECOND = 254016000000;

/** Timeline frame of a transition's edit point. */
function cutPoint(t: Element, seqRate: Rate): number {
  const ts = num(t, 'start') ?? 0;
  const te = num(t, 'end') ?? ts;
  const ticks = num(t, 'cutPointTicks');
  if (ticks !== undefined) {
    const fpsVal = seqRate.ntsc ? (seqRate.timebase * 1000) / 1001 : seqRate.timebase;
    return ts + Math.round((ticks * fpsVal) / TICKS_PER_SECOND);
  }
  const align = (txt(t, 'alignment') ?? 'center').toLowerCase();
  if (align.startsWith('start')) return ts;
  if (align.startsWith('end')) return te;
  return Math.round((ts + te) / 2);
}
