/**
 * Timecode math. All timeline positions inside the app are stored as integer
 * frame counts at the sequence timebase (e.g. 24 for 23.976). Timecode strings
 * are only produced at the edges (display, export).
 */

export interface Rate {
  /** Nominal integer timebase: 24, 25, 30, 60 ... */
  timebase: number;
  /** True for the 1000/1001 family (23.976, 29.97, 59.94). */
  ntsc: boolean;
}

export const DEFAULT_RATE: Rate = { timebase: 24, ntsc: true };

/** Real frames per second for a rate. */
export function fps(rate: Rate): number {
  return rate.ntsc ? (rate.timebase * 1000) / 1001 : rate.timebase;
}

export function rateLabel(rate: Rate): string {
  if (!rate.ntsc) return String(rate.timebase);
  const v = fps(rate);
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Drop-frame only exists for NTSC 30 and 60. */
export function canDropFrame(rate: Rate): boolean {
  return rate.ntsc && (rate.timebase === 30 || rate.timebase === 60);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Convert a frame count to HH:MM:SS:FF (or HH;MM;SS;FF for drop-frame). */
export function framesToTC(frames: number, timebase: number, dropFrame = false): string {
  const neg = frames < 0;
  let f = Math.abs(Math.round(frames));
  if (dropFrame && (timebase === 30 || timebase === 60)) {
    const d = timebase === 60 ? 4 : 2;
    const perMin = timebase * 60 - d;
    const per10 = timebase * 600 - d * 9;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += d * 9 * tens + (rem > d ? d * Math.floor((rem - d) / perMin) : 0);
  }
  const ff = f % timebase;
  const totalSec = Math.floor(f / timebase);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const sep = dropFrame ? ';' : ':';
  return `${neg ? '-' : ''}${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`;
}

const TC_RE = /^(-)?(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.,](\d{2,3})$/;

export function isTimecode(s: string): boolean {
  return TC_RE.test(s.trim());
}

/** Parse HH:MM:SS:FF into a frame count. Returns NaN when invalid. */
export function tcToFrames(tc: string, timebase: number, dropFrame?: boolean): number {
  const m = TC_RE.exec(tc.trim());
  if (!m) return NaN;
  const [, neg, h, mi, s, f] = m;
  const hh = +h, mm = +mi, ss = +s, ff = +f;
  const df = dropFrame ?? tc.includes(';');
  let frames = (hh * 3600 + mm * 60 + ss) * timebase + ff;
  if (df && (timebase === 30 || timebase === 60)) {
    const d = timebase === 60 ? 4 : 2;
    const totalMin = hh * 60 + mm;
    frames -= d * (totalMin - Math.floor(totalMin / 10));
  }
  return neg ? -frames : frames;
}

/** Duration as HH:MM:SS:FF. */
export function durationTC(frames: number, timebase: number): string {
  return framesToTC(Math.max(0, frames), timebase, false);
}

/**
 * Duration as m:ss for cue sheets. Partial seconds round up, which is the
 * usual cue sheet convention (any use of a second counts).
 */
export function durationMinSec(frames: number, rate: Rate): string {
  const secs = Math.ceil(Math.max(0, frames) / fps(rate) - 1e-6);
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

/** Signed, compact delta for change badges, e.g. "-30s 8f" or "+2f". */
export function deltaLabel(frames: number, timebase: number): string {
  if (frames === 0) return '0f';
  const sign = frames < 0 ? '−' : '+';
  const f = Math.abs(frames);
  const secs = Math.floor(f / timebase);
  const rem = f % timebase;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  if (rem || parts.length === 0) parts.push(`${rem}f`);
  return sign + parts.join(' ');
}

/** Guess a source timebase from a TC string's frame field (EDL sources). */
export function guessTimebaseFromTC(tc: string): number {
  const m = TC_RE.exec(tc.trim());
  if (!m) return 30;
  const ff = +m[5];
  return ff >= 30 ? 60 : ff >= 25 ? 30 : 30;
}
