import { looseName } from '../merge';
import { newId } from '../pipeline';
import { fps, type Rate } from '../timecode';
import type { Item } from '../types';

/**
 * SRT (and the cue body of a WebVTT) → subtitle items.
 * Times are milliseconds, or HH:MM:SS:FF when a file was exported in frames.
 * The whole file is shifted so that its zero lands on `zeroFrame`.
 */

interface Stamp {
  h: number;
  m: number;
  s: number;
  frac: number;
  unit: 'ms' | 'frames';
}

export interface SrtCue {
  start: Stamp;
  end: Stamp;
  text: string;
}

const TIME = String.raw`(\d{1,2}):(\d{2}):(\d{2})(?:([.,])(\d{1,3})|:(\d{2}))`;
const TIME_RE = new RegExp(`${TIME}\\s*-->\\s*${TIME}`);

function stamp(h: string, m: string, s: string, sep: string | undefined, frac: string | undefined, frames: string | undefined): Stamp | undefined {
  const hh = +h;
  const mm = +m;
  const ss = +s;
  if (mm > 59 || ss > 59) return undefined;
  if (frames !== undefined) return { h: hh, m: mm, s: ss, frac: +frames, unit: 'frames' };
  const digits = frac?.length ?? 3;
  let ms = +(frac ?? '0');
  if (digits === 2) ms *= 10;
  else if (digits === 1) ms *= 100;
  if (sep === undefined && frac === undefined) return undefined;
  return { h: hh, m: mm, s: ss, frac: ms, unit: 'ms' };
}

function parseStamp(raw: RegExpMatchArray, at: number): Stamp | undefined {
  return stamp(raw[at], raw[at + 1], raw[at + 2], raw[at + 3], raw[at + 4], raw[at + 5]);
}

/** Plain text: drop subtitle styling, keep line breaks. */
export function plainCue(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\\?[^}\n]*\}/g, '')
    .replace(/<[^>\n]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function parseSRT(text: string): { cues: SrtCue[]; warnings: string[] } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cues: SrtCue[] = [];
  let skipped = 0;
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timeAt = lines.findIndex((l) => l.includes('-->'));
    if (timeAt < 0) continue;
    const m = TIME_RE.exec(lines[timeAt].trim());
    const start = m && parseStamp(m, 1);
    const end = m && parseStamp(m, 7);
    const body = plainCue(lines.slice(timeAt + 1).join('\n'));
    if (!start || !end || !body) {
      skipped++;
      continue;
    }
    cues.push({ start, end, text: body });
  }
  const warnings: string[] = [];
  if (!cues.length) warnings.push('No subtitles found — is this an SRT?');
  else if (skipped) warnings.push(`${skipped} cue${skipped === 1 ? '' : 's'} had no usable timecode and were skipped.`);
  return { cues, warnings };
}

/**
 * SRT milliseconds are real time. A 23.976 sequence counts 24 frames per
 * timecode second, so treating that clock as 24fps lands a cue late — a few
 * seconds by the end of the hour, which is the next subtitle.
 */
export function stampToFrames(st: Stamp, rate: Rate): number {
  if (st.unit === 'frames') return (st.h * 3600 + st.m * 60 + st.s) * rate.timebase + st.frac;
  const real = st.h * 3600 + st.m * 60 + st.s + st.frac / 1000;
  return Math.round(real * fps(rate));
}

/**
 * Where 00:00:00 in the file sits on the sequence.
 * A file whose first cue is already near picture start (or later) is left
 * alone. A file timed from zero is placed on picture start.
 */
export function srtZeroFrame(firstIn: number, pictureStart: number, timebase: number): number {
  if (!Number.isFinite(firstIn)) return pictureStart;
  if (firstIn >= pictureStart - timebase * 60 * 10) return 0;
  return pictureStart;
}

/** Frame of the first cue before any zero offset, or undefined when the file has none. */
export function firstCueFrame(text: string, rate: Rate): number | undefined {
  const { cues } = parseSRT(text);
  return cues.length ? stampToFrames(cues[0].start, rate) : undefined;
}

export function buildSubtitleItems(text: string, rate: Rate, zeroFrame: number): { items: Item[]; warnings: string[] } {
  const { cues, warnings } = parseSRT(text);
  const items: Item[] = [];
  let untimed = 0;
  for (const cue of cues) {
    const recIn = stampToFrames(cue.start, rate) + zeroFrame;
    const recOut = stampToFrames(cue.end, rate) + zeroFrame;
    if (!(recOut > recIn)) {
      untimed++;
      continue;
    }
    const line = cue.text.split('\n')[0];
    const key = looseName(cue.text) || String(recIn);
    items.push({
      id: newId(),
      kind: 'video',
      name: line,
      groupKey: `sub|${key}`,
      recIn,
      recOut,
      tracks: [],
      segments: [{ name: line, recIn, recOut, tracks: [] }],
      auto: { clipName: cue.text, subtitle: cue.text },
      flags: [],
      values: {},
    });
  }
  if (untimed && cues.length) warnings.push(`${untimed} cue${untimed === 1 ? '' : 's'} had no usable timecode and were skipped.`);
  return { items, warnings };
}
