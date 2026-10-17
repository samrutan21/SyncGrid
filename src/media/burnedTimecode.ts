import { fps, framesToTC, tcToFrames, type Rate } from '../core/timecode';

/**
 * Read a burned-in timecode from the picture.
 *
 * A single frame is not trusted: the same corner is read again a few frames
 * later and kept only when the counter has advanced by exactly that many
 * frames. Anything ambiguous (no digits, a clock that doesn't move, two
 * different readings) is ignored.
 */

/** 5×7 prototypes. Real burns only pass when they still look like these after scaling down. */
export const BURNED_GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['10001', '10001', '10001', '11111', '00001', '00001', '00001'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ':': ['00000', '00100', '00000', '00000', '00100', '00000', '00000'],
};

export const GLYPH_MIN_SCORE = 0.86;
export const GLYPH_MIN_MARGIN = 0.08;

const STEP_FRAMES = 12;

export function recognizeGrid(rows: readonly string[]): { ch: string; score: number; margin: number } | null {
  if (rows.length !== 7 || rows.some((r) => r.length !== 5)) return null;
  let best = '';
  let bestS = -1;
  let second = -1;
  for (const [ch, proto] of Object.entries(BURNED_GLYPHS)) {
    let same = 0;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === proto[y][x]) same++;
    const s = same / 35;
    if (s > bestS) {
      second = bestS;
      bestS = s;
      best = ch;
    } else if (s > second) second = s;
  }
  if (!best) return null;
  return { ch: best, score: bestS, margin: bestS - (second < 0 ? 0 : second) };
}

/**
 * Two readings of the same burn. `atFrame` is where `first` was sampled
 * (0 = the first frame of the file). Returns the file's start timecode.
 */
export function burnedStartFromPair(first: string, second: string, atFrame: number, step: number, timebase: number): string | null {
  if (step <= 0 || atFrame < 0 || timebase < 1) return null;
  const df = first.includes(';') || second.includes(';');
  const a = tcToFrames(first, timebase, df);
  const b = tcToFrames(second, timebase, df);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a !== step) return null;
  const start = a - atFrame;
  if (start < 0) return null;
  return framesToTC(start, timebase, df);
}

/** Find one burned-in timecode in a decoded frame. Null when it isn't confident. */
export function readTimecodeFromPixels(pixels: Uint8ClampedArray, width: number, height: number): string | null {
  if (width < 40 || height < 24 || pixels.length < width * height * 4) return null;
  const lum = luminance(pixels, width, height);
  const radius = Math.max(2, Math.round(Math.min(width, height) / 40));
  const blurred = boxBlur(lum, width, height, radius);
  const hits: { tc: string; score: number }[] = [];
  for (const bright of [true, false]) {
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < lum.length; i++) {
      const d = lum[i] - blurred[i];
      if (bright ? d > 36 : d < -36) mask[i] = 1;
    }
    for (const band of bands(mask, width, height)) {
      const hit = readBand(mask, width, band.y0, band.y1);
      if (hit) hits.push(hit);
    }
  }
  const good = hits.filter((h) => h.score >= 0.9);
  const uniq = [...new Set(good.map((h) => h.tc))];
  return uniq.length === 1 ? uniq[0] : null;
}

export interface BurnedRead {
  tc: string | null;
  /** Frames were decoded, so a miss is real and doesn't need another try. */
  settled: boolean;
}

export async function readBurnedStartTC(file: Blob, rate: Rate, budgetMs = 4000): Promise<BurnedRead> {
  const unsettled: BurnedRead = { tc: null, settled: false };
  if (typeof document === 'undefined') return unsettled;
  const deadline = Date.now() + budgetMs;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadeddata', Math.min(2500, Math.max(200, deadline - Date.now())));
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) return unsettled;
    const spf = 1 / fps(rate);
    const frames = Math.floor(video.duration / spf);
    const step = frames > STEP_FRAMES + 2 ? STEP_FRAMES : frames > 2 ? 1 : 0;
    if (!step) return unsettled;
    let settled = false;
    const first = await readPair(video, rate, 0, step, spf, deadline);
    if (first.tc) return { tc: first.tc, settled: true };
    settled = first.settled;
    const later = Math.min(rate.timebase, frames - step - 1);
    if (later > 0 && Date.now() < deadline) {
      const second = await readPair(video, rate, later, step, spf, deadline);
      if (second.tc) return { tc: second.tc, settled: true };
      settled = settled || second.settled;
    }
    return { tc: null, settled };
  } catch {
    return unsettled;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function readPair(
  video: HTMLVideoElement,
  rate: Rate,
  atFrame: number,
  step: number,
  spf: number,
  deadline: number,
): Promise<BurnedRead> {
  const a = await grabFrame(video, (atFrame + 0.5) * spf, deadline);
  if (!a) return { tc: null, settled: false };
  const b = await grabFrame(video, (atFrame + step + 0.5) * spf, deadline);
  if (!b) return { tc: null, settled: false };
  const start =
    a.tc && b.tc ? burnedStartFromPair(a.tc, b.tc, atFrame, step, rate.timebase) : null;
  return { tc: start, settled: true };
}

async function grabFrame(video: HTMLVideoElement, time: number, deadline: number): Promise<{ tc: string | null } | null> {
  const left = deadline - Date.now();
  if (left < 150) return null;
  try {
    await seekTo(video, Math.min(time, Math.max(0, (video.duration || time) - 0.001)), Math.min(2000, left));
  } catch {
    return null;
  }
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return null;
  const scale = srcW > 960 ? 960 / srcW : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return { tc: readTimecodeFromPixels(image.data, w, h) };
}

function seekTo(video: HTMLVideoElement, time: number, timeout: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= 2) return Promise.resolve();
  video.currentTime = time;
  return once(video, 'seeked', timeout);
}

function once(el: HTMLMediaElement, ev: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(ev));
    }, timeout);
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('decode'));
    };
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ev, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

function luminance(pixels: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (pixels[p] * 2 + pixels[p + 1] * 5 + pixels[p + 2]) >> 3;
  return out;
}

function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Float32Array(w * h);
  const dst = new Uint8Array(w * h);
  const pref = new Float32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    pref[0] = 0;
    for (let x = 0; x < w; x++) pref[x + 1] = pref[x] + src[row + x];
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w - 1, x + r);
      tmp[row + x] = (pref[b + 1] - pref[a]) / (b - a + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    pref[0] = 0;
    for (let y = 0; y < h; y++) pref[y + 1] = pref[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r);
      dst[y * w + x] = (pref[b + 1] - pref[a]) / (b - a + 1);
    }
  }
  return dst;
}

function bands(mask: Uint8Array, w: number, h: number): { y0: number; y1: number }[] {
  const rowOn: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let c = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) c += mask[row + x];
    const f = c / w;
    rowOn.push(f > 0.004 && f < 0.45);
  }
  const out: { y0: number; y1: number }[] = [];
  let y = 0;
  while (y < h) {
    if (!rowOn[y]) {
      y++;
      continue;
    }
    const y0 = y;
    while (y < h && (rowOn[y] || (y + 1 < h && rowOn[y + 1] && y - y0 < 80))) y++;
    const bh = y - y0;
    if (bh >= 8 && bh <= Math.max(80, h * 0.22)) out.push({ y0, y1: y });
  }
  return out.slice(0, 16);
}

function readBand(mask: Uint8Array, w: number, y0: number, y1: number): { tc: string; score: number } | null {
  const hist = new Int32Array(w);
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) hist[x] += mask[y * w + x];
  const glyphs: { x0: number; x1: number }[] = [];
  let x = 0;
  while (x < w) {
    if (hist[x] === 0) {
      x++;
      continue;
    }
    const x0 = x;
    while (x < w && hist[x] > 0) x++;
    if (x - x0 >= 2) glyphs.push({ x0, x1: x });
  }
  if (glyphs.length < 11) return null;
  let best: { tc: string; score: number } | null = null;
  for (let i = 0; i + 11 <= glyphs.length; i++) {
    const hit = classifyWindow(mask, w, y0, y1 - y0, glyphs.slice(i, i + 11));
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best;
}

function classifyWindow(
  mask: Uint8Array,
  w: number,
  y0: number,
  bh: number,
  glyphs: { x0: number; x1: number }[],
): { tc: string; score: number } | null {
  const widths = glyphs.map((g) => g.x1 - g.x0).sort((a, b) => a - b);
  const boxW = Math.max(widths[widths.length >> 1], Math.round((bh * 5) / 7));
  let tc = '';
  let score = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const grid = resample(mask, w, y0, bh, glyphs[i].x0, glyphs[i].x1, boxW);
    if (!grid) return null;
    const m = recognizeGrid(grid);
    if (!m || m.score < GLYPH_MIN_SCORE || m.margin < GLYPH_MIN_MARGIN) return null;
    const sep = i === 2 || i === 5 || i === 8;
    if (sep ? m.ch !== ':' : m.ch === ':') return null;
    tc += m.ch;
    score += m.score;
  }
  if (!/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(tc)) return null;
  const hh = +tc.slice(0, 2);
  const mm = +tc.slice(3, 5);
  const ss = +tc.slice(6, 8);
  const ff = +tc.slice(9, 11);
  if (hh > 23 || mm > 59 || ss > 59 || ff > 60) return null;
  return { tc, score: score / glyphs.length };
}

function resample(mask: Uint8Array, w: number, y0: number, bh: number, x0: number, x1: number, boxW: number): string[] | null {
  const gw = x1 - x0;
  if (gw < 1 || bh < 7 || boxW < 1) return null;
  // Keep narrow glyphs (1, colon) narrow instead of stretching them to fill the cell.
  const pad = Math.max(0, boxW - gw);
  const left = Math.floor(pad / 2);
  const origin = x0 - left;
  const rows: string[] = [];
  for (let gy = 0; gy < 7; gy++) {
    const ya = y0 + Math.floor((gy * bh) / 7);
    const yb = Math.max(ya + 1, y0 + Math.floor(((gy + 1) * bh) / 7));
    let row = '';
    for (let gx = 0; gx < 5; gx++) {
      const xa = origin + Math.floor((gx * boxW) / 5);
      const xb = Math.max(xa + 1, origin + Math.floor(((gx + 1) * boxW) / 5));
      let on = 0;
      let tot = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          tot++;
          if (x >= x0 && x < x1 && y >= y0 && y < y0 + bh && x >= 0 && x < w) on += mask[y * w + x];
        }
      }
      row += tot && on / tot >= 0.35 ? '1' : '0';
    }
    rows.push(row);
  }
  return rows;
}
