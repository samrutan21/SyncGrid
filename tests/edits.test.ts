import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { carryValues } from '../src/core/diff';
import { isDismissed, moveEdge } from '../src/core/edits';
import type { ExportTable } from '../src/export/table';
import { buildXlsx } from '../src/export/xlsx';
import { shotFrameOf } from '../src/media/screenshots';
import type { CategoryConfig, Item } from '../src/core/types';

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
    segments: over.segments ?? [{ name: 'Clip', recIn, recOut, tracks: [] }],
    auto: {},
    flags: [],
    values: {},
    ...over,
  };
}

const cat = (screenshotAt: 'in' | 'mid' | undefined) => ({ screenshotAt }) as CategoryConfig;

describe('screenshot frame', () => {
  it('uses the middle of the cut for GFX and archival', () => {
    expect(shotFrameOf(item(), cat('mid'))).toBe(150);
    expect(shotFrameOf(item(), cat(undefined))).toBe(150);
  });
  it('stays a couple of frames in when a category asks for the first frame', () => {
    expect(shotFrameOf(item(), cat('in'))).toBe(102);
  });
  it('keeps a chosen frame inside the cut', () => {
    expect(shotFrameOf(item({ shotFrame: 50 }), cat('mid'))).toBe(100);
    expect(shotFrameOf(item({ shotFrame: 900 }), cat('mid'))).toBe(199);
    expect(shotFrameOf(item({ recIn: 10, recOut: 11 }), cat('mid'))).toBe(10);
  });
});

describe('editing an entry', () => {
  it('shifts an edge and remembers it for the next import', () => {
    const it = item();
    expect(moveEdge(it, 'in', 110)).toBe('ok');
    expect(it.recIn).toBe(110);
    expect(it.shift).toEqual({ in: 10, out: 0 });
    expect(it.segments[0].recIn).toBe(110);
    expect(moveEdge(it, 'out', 110)).toBe('invalid');
    expect(it.recOut).toBe(200);
  });

  it('does not bring back a removed cut that still overlaps', () => {
    const gone = [{ groupKey: 'video|clip', recIn: 100, recOut: 200 }];
    expect(isDismissed(item({ recIn: 150, recOut: 180 }), gone)).toBe(true);
    expect(isDismissed(item({ recIn: 200, recOut: 240 }), gone)).toBe(false);
    expect(isDismissed(item({ groupKey: 'video|other', recIn: 100, recOut: 200 }), gone)).toBe(false);
  });

  it('reapplies a shift when values are carried onto a new import', () => {
    const prev = item({ id: 'p', recIn: 110, recOut: 210, shift: { in: 10, out: 10 }, shotFrame: 160, values: { note: 'keep' } });
    const next = item({ id: 'n', recIn: 130, recOut: 230 });
    expect(carryValues([prev], [next])).toBe(1);
    expect(next.recIn).toBe(140);
    expect(next.recOut).toBe(240);
    expect(next.shotFrame).toBe(190);
    expect(next.values.note).toBe('keep');
    expect(next.segments[0].recIn).toBe(140);
    expect(next.segments[0].recOut).toBe(240);
  });
});

describe('xlsx export', () => {
  it('writes one sheet per tracker and anchors the picture to its cell', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const sheet = (label: string, image: boolean): ExportTable => ({
      category: { label } as ExportTable['category'],
      columns: [
        { label: 'Name', width: 2, isImage: false },
        { label: 'Screenshot', width: 1.4, isImage: true },
      ],
      rows: [
        [
          { text: '=1+1' },
          image
            ? { text: 'screenshots/a.jpg', images: [{ key: 'shot', name: 'a.png', type: 'image/png', path: 'screenshots/a.png' }] }
            : { text: '' },
        ],
      ],
      removed: [],
    });
    const bytes = await buildXlsx([sheet('GFX', true), sheet('Archival', true), sheet('Cue Sheet', false)], async (key) =>
      key === 'shot' ? new Blob([png], { type: 'image/png' }) : undefined,
    );
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbook).toContain('name="GFX"');
    expect(workbook).toContain('name="Archival"');
    expect(workbook).toContain('name="Cue Sheet"');
    const gfx = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(gfx).toContain('t="inlineStr"');
    expect(gfx).toContain('=1+1');
    expect(gfx).not.toContain('<f>');
    expect(await zip.file('xl/drawings/drawing1.xml')!.async('string')).toContain('r:embed="rId1"');
    expect(zip.file('xl/drawings/drawing3.xml')).toBeNull();
    const stored = await zip.file('xl/media/image1.png')!.async('uint8array');
    expect(Array.from(stored)).toEqual(Array.from(png));
    expect(zip.file('xl/media/image2.png')).toBeNull();
  });
});
