import { describe, expect, it } from 'vitest';
import { BURNED_GLYPHS, GLYPH_MIN_MARGIN, GLYPH_MIN_SCORE, burnedStartFromPair, readTimecodeFromPixels, recognizeGrid } from '../src/media/burnedTimecode';
import { interpretSample, readContainerStartTC } from '../src/media/fileTimecode';
import { tcToFrames } from '../src/core/timecode';

const SENT = 0xa1b2c3d4;

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
function fullBox(type: string, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body.set(payload, 4);
  return box(type, body);
}
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function tmcdEntry(fps: number, flags: number): Uint8Array {
  const body = new Uint8Array(28);
  const view = new DataView(body.buffer);
  body[7] = 1;
  view.setUint32(12, flags);
  view.setUint32(16, fps);
  view.setUint32(20, 1);
  body[24] = fps;
  return box('tmcd', body);
}
function sampleBytes(frame: number): Uint8Array {
  return u32(frame >>> 0);
}

/** Minimal MP4/MOV whose only track is a timecode track. */
function timecodeFile(sample: Uint8Array, fps: number, flags: number, opts?: { moovFirst?: boolean; co64?: boolean }): Blob {
  const entry = tmcdEntry(fps, flags);
  const stsdPayload = cat(u32(1), entry);
  const stszPayload = cat(u32(4), u32(1));
  const stcoPayload = opts?.co64 ? cat(u32(1), u32(0), u32(SENT)) : cat(u32(1), u32(SENT));
  const stbl = box('stbl', cat(fullBox('stsd', stsdPayload), fullBox('stsz', stszPayload), fullBox(opts?.co64 ? 'co64' : 'stco', stcoPayload)));
  const moov = box('moov', box('trak', box('mdia', box('minf', stbl))));
  const mdat = box('mdat', sample);
  const moovFirst = opts?.moovFirst !== false;
  const sampleAt = moovFirst ? moov.length + 8 : 8;
  const file = moovFirst ? cat(moov, mdat) : cat(mdat, moov);
  const view = new DataView(file.buffer);
  if (opts?.co64) {
    for (let i = 0; i + 8 <= file.length; i++) {
      if (view.getUint32(i) === 0 && view.getUint32(i + 4) === SENT) {
        view.setBigUint64(i, BigInt(sampleAt));
        break;
      }
    }
  } else {
    for (let i = 0; i + 4 <= file.length; i++) {
      if (view.getUint32(i) === SENT) {
        view.setUint32(i, sampleAt);
        break;
      }
    }
  }
  return new Blob([toBuffer(file)]);
}

function paint(tc: string, scale = 2): { pixels: Uint8ClampedArray; width: number; height: number } {
  const glyphs = [...tc].map((ch) => BURNED_GLYPHS[ch]);
  const gw = 5 * scale;
  const gh = 7 * scale;
  const gap = 3;
  const textW = glyphs.length * gw + (glyphs.length - 1) * gap;
  const width = 320;
  const height = 180;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 10;
    pixels[i + 1] = 12;
    pixels[i + 2] = 16;
    pixels[i + 3] = 255;
  }
  const x0 = Math.floor((width - textW) / 2);
  const y0 = height - gh - 20;
  glyphs.forEach((g, i) => {
    const ox = x0 + i * (gw + gap);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const p = ((y0 + y * scale + dy) * width + ox + x * scale + dx) * 4;
            pixels[p] = pixels[p + 1] = pixels[p + 2] = 245;
          }
        }
      }
    }
  });
  return { pixels, width, height };
}

describe('container start timecode', () => {
  it('reads a frame-number sample of 00:59:52:00', async () => {
    const frame = tcToFrames('00:59:52:00', 24);
    expect(frame).toBe(86208);
    const tc = await readContainerStartTC(timecodeFile(sampleBytes(frame), 24, 0));
    expect(tc).toBe('00:59:52:00');
  });

  it('reads the same value when moov is after mdat, and from a 64-bit offset', async () => {
    const sample = sampleBytes(86208);
    expect(await readContainerStartTC(timecodeFile(sample, 24, 0, { moovFirst: false }))).toBe('00:59:52:00');
    expect(await readContainerStartTC(timecodeFile(sample, 24, 0, { co64: true }))).toBe('00:59:52:00');
  });

  it('reads a packed hours/minutes/seconds/frames sample', async () => {
    const tc = await readContainerStartTC(timecodeFile(new Uint8Array([0, 59, 52, 0]), 24, 0));
    expect(tc).toBe('00:59:52:00');
  });

  it('reads a drop-frame frame count', async () => {
    const frame = tcToFrames('01:00:00;00', 30, true);
    expect(await readContainerStartTC(timecodeFile(sampleBytes(frame), 30, 0x0001))).toBe('01:00:00;00');
  });

  it('does not guess when the two layouts disagree', () => {
    expect(interpretSample(new Uint8Array([0, 0, 5, 0]), 24, 0)).toBeNull();
    expect(interpretSample(new Uint8Array([0, 0, 5, 0]), 24, 0x0008)).toBe('00:00:53:08');
  });

  it('ignores files with no timecode track', async () => {
    expect(await readContainerStartTC(new Blob([toBuffer(box('ftyp', u32(0)))]))).toBeNull();
    expect(await readContainerStartTC(new Blob(['not a movie']))).toBeNull();
    expect(await readContainerStartTC(new Blob())).toBeNull();
  });
});

describe('burned-in timecode', () => {
  it('tells its own glyphs apart', () => {
    for (const [ch, rows] of Object.entries(BURNED_GLYPHS)) {
      const m = recognizeGrid(rows);
      expect(m?.ch, ch).toBe(ch);
      expect(m!.score, ch).toBeGreaterThanOrEqual(GLYPH_MIN_SCORE);
      expect(m!.margin, ch).toBeGreaterThanOrEqual(GLYPH_MIN_MARGIN);
    }
  });

  it('reads a white timecode burned over a dark frame', () => {
    const frame = paint('00:59:52:00');
    expect(readTimecodeFromPixels(frame.pixels, frame.width, frame.height)).toBe('00:59:52:00');
    const later = paint('00:59:52:12');
    expect(readTimecodeFromPixels(later.pixels, later.width, later.height)).toBe('00:59:52:12');
    const bigger = paint('01:00:00:00', 4);
    expect(readTimecodeFromPixels(bigger.pixels, bigger.width, bigger.height)).toBe('01:00:00:00');
  });

  it('ignores a frame with no timecode', () => {
    const pixels = new Uint8ClampedArray(320 * 180 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      const x = (i / 4) % 320;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = (x / 320) * 80;
      pixels[i + 3] = 255;
    }
    expect(readTimecodeFromPixels(pixels, 320, 180)).toBeNull();
  });

  it('accepts a pair only when the counter advanced by the step', () => {
    expect(burnedStartFromPair('00:59:52:00', '00:59:52:12', 0, 12, 24)).toBe('00:59:52:00');
    expect(burnedStartFromPair('00:59:52:02', '00:59:52:14', 2, 12, 24)).toBe('00:59:52:00');
    expect(burnedStartFromPair('00:59:52:00', '00:59:55:00', 0, 12, 24)).toBeNull();
    expect(burnedStartFromPair('00:59:52:00', '00:59:52:00', 0, 12, 24)).toBeNull();
  });
});
