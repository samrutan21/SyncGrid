import { describe, expect, it } from 'vitest';
import { defaultCategories, defaultSettings } from '../src/core/config/defaults';
import { carryValues, diffItems } from '../src/core/diff';
import { importCategory, suggestEpisodeName, suggestVersionLabel } from '../src/core/importer';
import { extractArchivalId, normalizeCue } from '../src/core/naming';
import { parseEDL } from '../src/core/parsers/edl';
import { parseXMEML } from '../src/core/parsers/xmeml';
import { findRepeats } from '../src/core/pipeline';
import { durationMinSec, framesToTC, tcToFrames } from '../src/core/timecode';
import type { CategoryConfig, Item } from '../src/core/types';
import { fixture, V3, V4 } from './fixtures';

const settings = () => ({ ...defaultSettings(), archivalPrefixes: ['OSOS'] });
const cat = (key: string) => defaultCategories().find((c) => c.key === key) as CategoryConfig;
const FILES: Record<string, string> = { gfx: 'GFX', music: 'CUE_SHEET', archival: 'ARCHIVAL' };
const slot = (v: string, key: string, which: 'both' | 'xml' | 'edl' = 'both') => ({
  xml: which !== 'edl' ? { fileName: 'x.xml', importedAt: '', text: fixture(`${v}${FILES[key]}.xml`) } : undefined,
  edl: which !== 'xml' ? { fileName: 'x.edl', importedAt: '', text: fixture(`${v}${FILES[key]}.edl`) } : undefined,
});
const load = (v: string, key: string, which: 'both' | 'xml' | 'edl' = 'both') =>
  importCategory(slot(v, key, which), cat(key), settings());
const tc = (f: number) => framesToTC(f, 24);
const byName = (items: Item[], part: string) => items.filter((i) => i.name.includes(part));

describe('timecode', () => {
  it('round-trips non-drop and drop-frame', () => {
    expect(tcToFrames('00:59:52:00', 24)).toBe(86208);
    expect(framesToTC(86208, 24)).toBe('00:59:52:00');
    for (const f of [0, 1799, 1800, 17982, 107892, 500000]) {
      expect(tcToFrames(framesToTC(f, 30, true), 30, true)).toBe(f);
      expect(tcToFrames(framesToTC(f, 60, true), 60, true)).toBe(f);
    }
    expect(framesToTC(1800, 30, true)).toBe('00:01:00;02');
  });
  it('formats cue durations as min:sec rounded up', () => {
    expect(durationMinSec(24 * 39 + 2, { timebase: 24, ntsc: true })).toBe('0:40');
  });
});

describe('parsers', () => {
  it('reads the Premiere XML sequence start and clips', () => {
    const x = parseXMEML(fixture(`${V3}GFX.xml`));
    expect(x.startFrame).toBe(86208);
    expect(x.rate.timebase).toBe(24);
    expect(x.events).toHaveLength(51);
  });
  it('reads the EDL incl. NONE + AUD channels', () => {
    const e = parseEDL(fixture(`${V3}ARCHIVAL.edl`));
    const a34 = e.events.filter((x) => x.tracks.includes('A3') || x.tracks.includes('A4'));
    expect(a34.length).toBe(2);
    expect(e.events[0].srcIn).toBe('00:34:10:05');
  });
  it('places clips inside cross-fades at the edit point, matching the EDL', () => {
    const xmlOnly = load(V3, 'archival', 'xml').items;
    const both = load(V3, 'archival').items;
    expect(xmlOnly).toHaveLength(both.length);
    xmlOnly.forEach((it, i) => {
      expect(tc(it.recIn)).toBe(tc(both[i].recIn));
      expect(tc(it.recOut)).toBe(tc(both[i].recOut));
      expect(it.srcIn).toBe(both[i].srcIn);
    });
  });
});

describe('merge XML + EDL', () => {
  for (const key of ['gfx', 'music', 'archival']) {
    it(`${key}: every event pairs up with no mismatch flags`, () => {
      const r = load(V3, key);
      expect(r.stats.matched).toBe(r.stats.xmlEvents);
      expect(r.stats.edlEvents).toBe(r.stats.xmlEvents);
      expect(r.items.filter((i) => i.flags.length).length).toBe(0);
    });
  }
  it('prefers XML names over EDL names with broken accents', () => {
    const cue = load(V3, 'music').items.find((i) => i.auto.cueTitle === 'El Mas Rah');
    expect(cue?.auto.artist).toBe('Ratchetón');
  });
});

describe('GFX grouping', () => {
  const items = load(V3, 'gfx').items;
  it('drops Black Video and groups split/extended graphics', () => {
    expect(items).toHaveLength(46);
    expect(byName(items, 'Black Video')).toHaveLength(0);
  });
  it('the 3-piece title is one entry', () => {
    const t = byName(items, 'osos_title');
    expect(t).toHaveLength(1);
    expect(t[0].segments).toHaveLength(3);
    expect(tc(t[0].recIn)).toBe('01:01:09:02');
    expect(tc(t[0].recOut)).toBe('01:01:14:10');
  });
  it('the lower third extended with copied frames is one entry', () => {
    const t = byName(items, 'torin_justice');
    expect(t).toHaveLength(1);
    expect(tc(t[0].recOut)).toBe('01:07:18:20');
  });
  it('reads source resolution', () => {
    expect(items[0].auto.resolution).toBe('3840×2160');
  });
});

describe('music grouping', () => {
  const items = load(V3, 'music').items;
  it('stems, instrumental versions and edits collapse to 13 cues', () => {
    expect(items.map((i) => i.auto.cueTitle)).toEqual([
      'Right Tie', '77 Cycles', 'Sending', 'FACE OFF', 'El Mas Rah', 'Cold Facts', 'Get Yours',
      'The Redline Principle', 'Bad Guy', 'Truth Interlapse', 'Like Whoa', 'Are You Ready', 'High Stakes',
    ]);
  });
  it('detects library and log notes', () => {
    expect(items[0].auto.library).toBe('Epidemic Sound');
    const ready = items.find((i) => i.auto.cueTitle === 'Are You Ready');
    expect(ready?.auto.logNote ?? '').toContain('isrc:SE5Q51824115');
  });
  it('a cue used again after a gap is a separate entry flagged as a repeat', () => {
    const base = items.find((i) => i.auto.cueTitle === 'Sending') as Item;
    const later: Item = { ...structuredClone(base), id: 'later', recIn: base.recIn + 24 * 600, recOut: base.recOut + 24 * 600 };
    const reps = findRepeats([...items, later], cat('music'));
    expect(reps.get('later')?.count).toBe(2);
  });
  it('normalizes cue names', () => {
    const n = normalizeCue('ES_Bad Guy (Instrumental Version) STEMS DRUMS - Nyck Caution.wav', defaultSettings().musicStripWords, defaultSettings().libraryPrefixes);
    expect(n.title).toBe('Bad Guy');
    expect(n.artist).toBe('Nyck Caution');
    expect(normalizeCue('Drums of War_INST.wav', defaultSettings().musicStripWords, {}).title).toBe('Drums of War');
  });
});

describe('archival', () => {
  const items = load(V3, 'archival').items;
  it('every cut is its own row; stacked mono pairs are one row', () => {
    expect(items).toHaveLength(69);
    const pair = items.find((i) => tc(i.recIn) === '01:17:20:16');
    expect(pair?.tracks.length).toBe(2);
    expect(items.filter((i) => tc(i.recIn) === '01:17:20:16')).toHaveLength(1);
    const pair2 = items.find((i) => tc(i.recIn) === '01:17:31:20');
    expect(pair2?.tracks.length).toBe(2);
  });
  it('extracts IDs and type; audio pulled from footage is Audio / Footage', () => {
    const a = items[0];
    expect(a.auto.archivalId).toBe('OSOS-F04454');
    expect(a.auto.usage).toBe('Audio');
    expect(a.auto.sourceType).toBe('Footage');
    expect(items[1].auto.usage).toBe('Video');
  });
  it('keeps 59.94 source timecode native', () => {
    expect(items.find((i) => i.auto.archivalId === 'OSOS-F00019')?.srcIn).toBe('00:22:16:36');
  });
  it('ID patterns are configurable', () => {
    expect(extractArchivalId('ARC-S00123_photo.jpg', ['ARC'], ['F', 'A', 'S'])?.id).toBe('ARC-S00123');
    expect(extractArchivalId('random.mov', ['ARC'], ['F'])).toBeUndefined();
  });
});

describe('version changes v3 → v4', () => {
  it('GFX: 17 graphics shifted by the 30s 8f cut, nothing new/removed', () => {
    const d = diffItems(load(V3, 'gfx').items, load(V4, 'gfx').items, 24);
    expect(d.counts.new).toBe(0);
    expect(d.counts.removed).toBe(0);
    expect(d.counts.shifted).toBe(17);
    const moved = [...d.changes.values()].find((c) => c.kind === 'shifted');
    expect(moved?.moved).toBe(-(30 * 24 + 8));
  });
  it('Music: Are You Ready shortened, High Stakes shifted', () => {
    const v4 = load(V4, 'music').items;
    const d = diffItems(load(V3, 'music').items, v4, 24);
    const ready = v4.find((i) => i.auto.cueTitle === 'Are You Ready') as Item;
    expect(d.changes.get(ready.id)?.kind).toBe('changed');
    expect(d.changes.get(ready.id)?.durationDelta).toBe(-(30 * 24 + 8));
    expect(d.counts.shifted).toBe(1);
  });
  it('Archival: last 5 cuts shifted, source unchanged', () => {
    const d = diffItems(load(V3, 'archival').items, load(V4, 'archival').items, 24);
    expect(d.counts.shifted).toBe(5);
    expect(d.counts.changed).toBe(0);
  });
  it('detects removed and new items', () => {
    const v3 = load(V3, 'gfx').items;
    const v4 = load(V4, 'gfx').items.filter((i) => !i.name.includes('ryan_kalil_OSOS_LT'));
    const d = diffItems(v3, v4, 24);
    expect(d.counts.removed).toBe(1);
    const d2 = diffItems(v4, v3, 24);
    expect(d2.counts.new).toBe(1);
  });
  it('carries notes forward to the matching items', () => {
    const v3 = load(V3, 'archival').items;
    v3[66].values.notes = 'Cleared with archive house';
    const v4 = load(V4, 'archival').items;
    expect(carryValues(v3, v4)).toBe(1);
    expect(v4[66].values.notes).toBe('Cleared with archive house');
  });
});

describe('naming suggestions', () => {
  it('suggests version + episode labels', () => {
    expect(suggestVersionLabel('OSOS_LP_S1_EP7_v4_261014_ProRes_Color_Ref _GFX', 'Version 1')).toBe('v4 · 261014');
    expect(suggestEpisodeName('OSOS_LP_S1_EP7_v4_261014_ProRes')).toBe('S1 EP7');
  });
});

describe('track numbering', () => {
  it('maps Premiere exploded stereo tracks back to real track numbers', () => {
    const x = parseXMEML(fixture(`${V3}CUE_SHEET.xml`));
    expect(x.tracks.map((t) => t.label)).toEqual(['A19', 'A20', 'A21', 'A22']);
    const a = parseXMEML(fixture(`${V3}ARCHIVAL.xml`));
    expect(a.tracks.map((t) => t.label)).toEqual(['V2', 'A11', 'A12', 'A13', 'A14']);
  });
});
