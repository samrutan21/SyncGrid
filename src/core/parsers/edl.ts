import { DEFAULT_RATE, tcToFrames, type Rate } from '../timecode';
import type { ParsedTimeline, TimelineEvent, TrackInfo } from '../types';

/**
 * CMX3600 EDL parser (the flavour Premiere, Resolve and Avid export).
 *
 * Handles: V / A / A2 / AA / B / AA/V channels, NONE + "AUD 3 4" extra audio
 * channels, dissolves/wipes (with duration field), FROM/TO CLIP NAME comments,
 * SOURCE FILE comments. Record timecode is converted to frames at `rate`;
 * source timecode is kept as text because each source can have its own rate.
 */

const TC = /^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/;
const EVENT_RE = /^(\d{1,6})\s+(\S+)\s+(\S+)\s+(.+)$/;

interface Pending {
  num: string;
  reel: string;
  channel: string;
  srcIn: string;
  srcOut: string;
  recIn: string;
  recOut: string;
  fromName?: string;
  toName?: string;
  sourceFile?: string;
  extraAudio: number[];
  transition: string;
}

export function parseEDL(text: string, rate: Rate = DEFAULT_RATE): ParsedTimeline {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  let dropFrame = false;
  const pending: Pending[] = [];
  let cur: Pending | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const t = line.trim();

    if (/^TITLE:/i.test(t)) {
      title = t.replace(/^TITLE:\s*/i, '').trim();
      continue;
    }
    if (/^FCM:/i.test(t)) {
      dropFrame = /DROP FRAME/i.test(t) && !/NON-DROP/i.test(t);
      continue;
    }
    if (t.startsWith('*')) {
      if (!cur) continue;
      const from = /^\*\s*FROM CLIP NAME:\s*(.*)$/i.exec(t);
      const to = /^\*\s*TO CLIP NAME:\s*(.*)$/i.exec(t);
      const src = /^\*\s*SOURCE FILE:\s*(.*)$/i.exec(t);
      if (from) cur.fromName = from[1].trim();
      else if (to) cur.toName = to[1].trim();
      else if (src) cur.sourceFile = src[1].trim();
      continue;
    }
    if (/^AUD\b/i.test(t)) {
      if (cur) {
        for (const n of t.replace(/^AUD/i, '').trim().split(/\s+/)) {
          const v = parseInt(n, 10);
          if (!Number.isNaN(v)) cur.extraAudio.push(v);
        }
      }
      continue;
    }
    if (/^(SPLIT|M2|SWM|FINAL CUT|>>>)/i.test(t)) continue;

    const m = EVENT_RE.exec(t);
    if (m) {
      const rest = m[4].trim().split(/\s+/);
      const tcs = rest.filter((x) => TC.test(x));
      if (tcs.length < 4) {
        warnings.push(`Skipped unreadable EDL line: "${t.slice(0, 80)}"`);
        continue;
      }
      const [srcIn, srcOut, recIn, recOut] = tcs.slice(-4);
      cur = {
        num: m[1],
        reel: m[2],
        channel: m[3].toUpperCase(),
        srcIn,
        srcOut,
        recIn,
        recOut,
        extraAudio: [],
        transition: rest[0] ?? 'C',
      };
      pending.push(cur);
    }
  }

  const events: TimelineEvent[] = [];
  for (const p of pending) {
    const name = (p.toName && p.transition !== 'C' ? p.toName : p.fromName) || p.sourceFile || p.reel;
    const recIn = tcToFrames(p.recIn, rate.timebase, dropFrame);
    const recOut = tcToFrames(p.recOut, rate.timebase, dropFrame);
    if (Number.isNaN(recIn) || Number.isNaN(recOut)) {
      warnings.push(`Event ${p.num}: bad record timecode`);
      continue;
    }
    const { video, audio } = channelsOf(p.channel, p.extraAudio);
    const flags: string[] = [];
    if (name.includes('�')) flags.push('Clip name has unreadable characters in the EDL');
    const base = {
      origin: 'edl' as const,
      name,
      recIn,
      recOut,
      srcIn: p.srcIn.replace(/;/g, ':'),
      srcOut: p.srcOut.replace(/;/g, ':'),
      reel: p.reel,
      filePath: p.sourceFile,
      eventNumbers: [p.num],
      isGenerator: /^(BL|BLK|BLACK)$/i.test(p.reel) || /^black video$/i.test(name),
      flags,
    };
    if (video) events.push({ ...base, kind: 'video', tracks: ['V'] });
    if (audio.length) events.push({ ...base, kind: 'audio', tracks: audio.map((a) => `A${a}`), flags: [...flags] });
  }

  const tracks: TrackInfo[] = [];
  const count = (label: string, kind: 'video' | 'audio') => {
    const t = tracks.find((x) => x.label === label);
    if (t) t.clipCount++;
    else tracks.push({ label, kind, clipCount: 1 });
  };
  for (const e of events) for (const tr of e.tracks) count(tr, e.kind);

  if (pending.length === 0) warnings.push('No events found — is this a CMX3600 EDL?');

  return {
    format: 'edl',
    sequenceName: title,
    rate,
    startFrame: null,
    events,
    tracks,
    warnings,
  };
}

function channelsOf(channel: string, extra: number[]): { video: boolean; audio: number[] } {
  const c = channel.toUpperCase();
  let video = false;
  const audio: number[] = [];
  if (c === 'NONE') {
    // Audio channels come from AUD lines only.
  } else if (c === 'B') {
    video = true;
    audio.push(1);
  } else {
    for (const part of c.split('/')) {
      if (part === 'V') video = true;
      else if (part === 'A') audio.push(1);
      else if (part === 'AA') audio.push(1, 2);
      else if (/^A\d+$/.test(part)) audio.push(parseInt(part.slice(1), 10));
      else if (part === 'B') {
        video = true;
        audio.push(1);
      }
    }
  }
  for (const n of extra) if (!audio.includes(n)) audio.push(n);
  return { video, audio };
}
