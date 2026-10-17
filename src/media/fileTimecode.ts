import { framesToTC, isTimecode } from '../core/timecode';

/**
 * Read the start timecode embedded in an MP4/MOV timecode track.
 *
 * QuickTime stores one 4-byte sample. Two layouts show up in real files:
 * a frame count (what Premiere, Resolve and ffmpeg write) or a packed
 * hours/minutes/seconds/frames record (the spec layout when the counter
 * flag is off). Each sample is decoded both ways. A value is kept only when
 * one layout is plausible, or both agree. A disagreement is ignored so a
 * guess never shifts the cut.
 */

const MAX_MOOV = 64 * 1024 * 1024;
const MAX_HOURS = 30;

export async function readContainerStartTC(file: Blob): Promise<string | null> {
  try {
    if (!file.size || file.size < 16) return null;
    let offset = 0;
    let atoms = 0;
    while (offset + 8 <= file.size && atoms < 64) {
      atoms++;
      const hdr = await readBytes(file, offset, Math.min(16, file.size - offset));
      const box = parseHeader(hdr, file.size - offset);
      if (!box) return null;
      if (box.type === 'moov') {
        const n = Math.min(box.size, file.size - offset);
        if (n < 8 || n > MAX_MOOV) return null;
        const moov = await readBytes(file, offset, n);
        const tracks = collectTimecodeTracks(moov);
        for (const t of tracks) {
          if (t.sampleOffset < 0 || t.sampleOffset + 4 > file.size) continue;
          const sample = await readBytes(file, t.sampleOffset, Math.min(t.sampleSize, 16));
          const tc = interpretSample(sample, t.fps, t.flags);
          if (tc && isTimecode(tc)) return tc;
        }
        return null;
      }
      if (offset + box.size > file.size) return null;
      offset += box.size;
    }
    return null;
  } catch {
    return null;
  }
}

interface TmcdTrack {
  fps: number;
  flags: number;
  sampleSize: number;
  sampleOffset: number;
}

/** Frame-count vs packed record. Exported for tests. */
export function interpretSample(sample: Uint8Array, fps: number, flags: number): string | null {
  if (sample.length < 4 || fps < 12 || fps > 120) return null;
  const drop = (flags & 0x0001) !== 0 && (fps === 30 || fps === 60);
  const raw = ((sample[0] << 24) | (sample[1] << 16) | (sample[2] << 8) | sample[3]) >>> 0;
  const counter = raw < fps * 3600 * MAX_HOURS ? framesToTC(raw, fps, drop) : null;

  const hours = sample[0];
  const negative = (sample[1] & 0x80) !== 0;
  const minutes = sample[1] & 0x7f;
  const seconds = sample[2];
  const frames = sample[3];
  const sep = drop ? ';' : ':';
  const packed =
    !negative && hours <= 23 && minutes <= 59 && seconds <= 59 && frames < fps
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${sep}${pad(frames)}`
      : null;

  // Counter flag: the sample is a frame count, full stop.
  if (flags & 0x0008) return counter;
  if (counter && packed && counter !== packed) return null;
  return counter ?? packed;
}

const pad = (n: number) => String(n).padStart(2, '0');

async function readBytes(file: Blob, offset: number, length: number): Promise<Uint8Array> {
  const slice = file.slice(offset, offset + length);
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsArrayBuffer(slice);
  });
  return new Uint8Array(buf);
}

function parseHeader(hdr: Uint8Array, remaining: number): { size: number; type: string } | null {
  if (hdr.length < 8) return null;
  const view = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  let size = view.getUint32(0);
  const type = typeAt(view, 4);
  if (size === 1) {
    if (hdr.length < 16) return null;
    const big = view.getBigUint64(8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big);
  } else if (size === 0) {
    size = remaining;
  }
  if (size < 8) return null;
  return { size, type };
}

function typeAt(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function collectTimecodeTracks(moov: Uint8Array): TmcdTrack[] {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const out: TmcdTrack[] = [];
  const header = moov.length >= 16 && view.getUint32(0) === 1 ? 16 : 8;
  walk(view, header, moov.length, null, out);
  return out;
}

function walk(view: DataView, start: number, end: number, trak: TmcdTrack | null, out: TmcdTrack[]) {
  forEachChild(view, start, end, (type, cs, ce) => {
    if (type === 'trak') {
      const t: TmcdTrack = { fps: 0, flags: 0, sampleSize: 0, sampleOffset: -1 };
      walk(view, cs, ce, t, out);
      if (t.fps >= 12 && t.fps <= 120 && t.sampleOffset >= 0 && t.sampleSize >= 4) out.push(t);
    } else if (type === 'mdia' || type === 'minf' || type === 'stbl') {
      walk(view, cs, ce, trak, out);
    } else if (trak && type === 'stsd') {
      const info = readTmcd(view, cs, ce);
      if (info) {
        trak.fps = info.fps;
        trak.flags = info.flags;
      }
    } else if (trak && type === 'stsz') {
      trak.sampleSize = firstSampleSize(view, cs, ce);
    } else if (trak && type === 'stco') {
      trak.sampleOffset = firstOffset(view, cs, ce, false);
    } else if (trak && type === 'co64') {
      trak.sampleOffset = firstOffset(view, cs, ce, true);
    }
  });
}

function forEachChild(
  view: DataView,
  start: number,
  end: number,
  fn: (type: string, contentStart: number, contentEnd: number) => void,
) {
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = typeAt(view, p + 4);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      const big = view.getBigUint64(p + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) return;
    fn(type, p + header, p + size);
    p += size;
  }
}

/** tmcd sample entry: flags at +20, numberOfFrames at +32 from the entry start. */
function readTmcd(view: DataView, start: number, end: number): { fps: number; flags: number } | null {
  if (end - start < 8) return null;
  const count = view.getUint32(start + 4);
  let p = start + 8;
  for (let i = 0; i < count && p + 8 <= end; i++) {
    const size = view.getUint32(p);
    if (size < 8 || p + size > end) return null;
    if (typeAt(view, p + 4) === 'tmcd' && size >= 34) {
      return { flags: view.getUint32(p + 20), fps: view.getUint8(p + 32) };
    }
    p += size;
  }
  return null;
}

function firstSampleSize(view: DataView, start: number, end: number): number {
  if (end - start < 12) return 0;
  const constant = view.getUint32(start + 4);
  if (constant) return constant;
  const count = view.getUint32(start + 8);
  if (!count || end - start < 16) return 0;
  return view.getUint32(start + 12);
}

function firstOffset(view: DataView, start: number, end: number, wide: boolean): number {
  if (end - start < 8) return -1;
  const count = view.getUint32(start + 4);
  if (!count) return -1;
  if (wide) {
    if (end - start < 16) return -1;
    const big = view.getBigUint64(start + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return -1;
    return Number(big);
  }
  if (end - start < 12) return -1;
  return view.getUint32(start + 8);
}
