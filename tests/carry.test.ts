import { describe, expect, it } from 'vitest';
import { carryByShot, carryValues, isAmbiguousName } from '../src/core/diff';
import { averageHash, hashDistance } from '../src/core/shotHash';
import { formatStack, parseStack, stackPlain, unwrapPastedCell } from '../src/core/stackText';
import type { Item } from '../src/core/types';

function item(over: Partial<Item> = {}): Item {
  const recIn = over.recIn ?? 100;
  const recOut = over.recOut ?? 200;
  return {
    id: 'a',
    kind: 'video',
    name: 'Clip',
    groupKey: 'video|clip',
    recIn,
    recOut,
    tracks: [],
    segments: over.segments ?? [{ name: over.name ?? 'Clip', recIn, recOut, tracks: [] }],
    auto: {},
    flags: [],
    values: {},
    ...over,
  };
}

describe('stacked text', () => {
  it('keeps a title as three sized lines and exports the words', () => {
    const stored = formatStack([
      { size: 'lg', text: 'WE ARE' },
      { size: 'lg', text: 'OSOS' },
      { size: 'sm', text: 'MONTERREY' },
    ]);
    expect(stored).toBe('^WE ARE\n^OSOS\n_MONTERREY');
    expect(parseStack(stored)).toEqual([
      { size: 'lg', text: 'WE ARE' },
      { size: 'lg', text: 'OSOS' },
      { size: 'sm', text: 'MONTERREY' },
    ]);
    expect(stackPlain(stored)).toBe('WE ARE\nOSOS\nMONTERREY');
    expect(stackPlain('already plain')).toBe('already plain');
  });

  it('drops the quotes Excel wraps around a multi-line cell', () => {
    expect(unwrapPastedCell('"TOMMY AUGER\r\nTIGHT END #39 / THIRD SEASON"')).toBe('TOMMY AUGER\nTIGHT END #39 / THIRD SEASON');
    expect(unwrapPastedCell('"TOMMY AUGER\nTIGHT END #39 / THIRD SEASON"\n')).toBe('TOMMY AUGER\nTIGHT END #39 / THIRD SEASON');
    expect(unwrapPastedCell('"He said ""hi""\nthere"')).toBe('He said "hi"\nthere');
    expect(unwrapPastedCell('TOMMY AUGER\nTIGHT END')).toBe('TOMMY AUGER\nTIGHT END');
    expect(unwrapPastedCell('"hello\n"world"')).toBe('"hello\n"world"');
  });
});

describe('carrying notes onto a new version', () => {
  it('treats placeholder names as ambiguous, including a trailing number', () => {
    expect(isAmbiguousName('Graphic')).toBe(true);
    expect(isAmbiguousName('Graphic.mov')).toBe(true);
    expect(isAmbiguousName('Graphic 2')).toBe(true);
    expect(isAmbiguousName('WE ARE OSOS')).toBe(false);
    expect(isAmbiguousName('ryan_kalil_OSOS_LT')).toBe(false);
  });

  it('carries a real name and leaves a placeholder blank', () => {
    const named = item({ id: 'p1', name: 'WE ARE OSOS', groupKey: 'video|weareosos', values: { text: '^WE ARE\n^OSOS\n_MONTERREY', link: 'https://example.com' } });
    const namedNext = item({ id: 'n1', name: 'WE ARE OSOS', groupKey: 'video|weareosos' });
    const temp = item({ id: 'p2', name: 'Graphic', groupKey: 'video|graphic', values: { text: 'do not copy' }, shift: { in: 5, out: 0 }, shotFrame: 120 });
    const tempNext = item({ id: 'n2', name: 'Graphic', groupKey: 'video|graphic' });
    expect(carryValues([named, temp], [namedNext, tempNext], { looseGenerics: true })).toBe(1);
    expect(namedNext.values.text).toBe('^WE ARE\n^OSOS\n_MONTERREY');
    expect(namedNext.values.link).toBe('https://example.com');
    expect(tempNext.values.text).toBeUndefined();
    expect(tempNext.shift).toBeUndefined();
    expect(tempNext.shotFrame).toBeUndefined();
  });

  it('still keeps placeholder notes when the same version is rebuilt', () => {
    const prev = item({ id: 'p', name: 'Graphic', groupKey: 'video|graphic', values: { text: 'keep' } });
    const next = item({ id: 'n', name: 'Graphic', groupKey: 'video|graphic' });
    expect(carryValues([prev], [next])).toBe(1);
    expect(next.values.text).toBe('keep');
  });

  it('copies a placeholder only when its picture matches one previous item', () => {
    const prev = item({ id: 'p', name: 'Graphic', groupKey: 'video|graphic', shotHash: '0000000000000000', values: { text: 'WE ARE', link: 'https://example.com' } });
    const next = item({ id: 'n', name: 'Graphic', groupKey: 'video|graphic', shotHash: '0000000000000000', values: { text: 'mine' } });
    expect(carryByShot([prev], [next])).toBe(1);
    expect(next.values.text).toBe('mine');
    expect(next.values.link).toBe('https://example.com');
    next.values.link = '';
    expect(carryByShot([prev], [next])).toBe(0);
    expect(next.values.link).toBe('');
  });

  it('does not guess when two pictures are close', () => {
    const a = item({ id: 'a', name: 'Graphic', groupKey: 'video|graphic', shotHash: '0000000000000000', values: { text: 'one' } });
    const b = item({ id: 'b', name: 'Graphic', groupKey: 'video|graphic', recIn: 300, recOut: 400, shotHash: '0000000000000003', values: { text: 'two' } });
    const next = item({ id: 'n', name: 'Graphic', groupKey: 'video|graphic', shotHash: '0000000000000000' });
    expect(carryByShot([a, b], [next])).toBe(0);
    expect(next.values.text).toBeUndefined();
  });

  it('can recognize a renamed graphic by its picture', () => {
    const prev = item({ id: 'p', name: 'Graphic', groupKey: 'video|graphic', shotHash: 'aaaaaaaaaaaaaaaa', values: { description: 'city opener' } });
    const next = item({ id: 'n', name: 'WE ARE OSOS', groupKey: 'video|weareosos', shotHash: 'aaaaaaaaaaaaaaaa' });
    expect(carryByShot([prev], [next])).toBe(1);
    expect(next.values.description).toBe('city opener');
  });
});

describe('screenshot hash', () => {
  function paint(w: number, h: number, fill: (x: number, y: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = fill(x, y);
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    return data;
  }

  it('matches the same picture and not its inverse', () => {
    const left = paint(32, 32, (x) => (x < 16 ? [0, 0, 0] : [255, 255, 255]));
    const again = paint(32, 32, (x) => (x < 16 ? [0, 0, 0] : [255, 255, 255]));
    const flipped = paint(32, 32, (x) => (x < 16 ? [255, 255, 255] : [0, 0, 0]));
    const a = averageHash(left, 32, 32);
    expect(hashDistance(a, averageHash(again, 32, 32))).toBe(0);
    expect(hashDistance(a, averageHash(flipped, 32, 32)) ?? 0).toBeGreaterThan(10);
  });
});
