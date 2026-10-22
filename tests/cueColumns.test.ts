import { describe, expect, it } from 'vitest';
import { defaultCategories, migrateArtistColumn, migrateMusicCueColumns } from '../src/core/config/defaults';
import type { CategoryConfig, Item } from '../src/core/types';

const music = () => defaultCategories().find((c) => c.key === 'music') as CategoryConfig;

describe('cue sheet columns', () => {
  it('puts the parsed title in Cue Name and leaves Temp Cue Name blank', () => {
    const columns = music().columns;
    const temp = columns.find((c) => c.id === 'tempCue');
    const cue = columns.find((c) => c.id === 'cueName');
    const artist = columns.find((c) => c.id === 'artist');
    expect(temp).toMatchObject({ type: 'text', label: 'Temp Cue Name' });
    expect(temp?.auto).toBeUndefined();
    expect(cue).toMatchObject({ type: 'text', prefill: 'cueTitle' });
    expect(artist).toMatchObject({ type: 'combo', prefill: 'artist' });
    expect(artist?.auto).toBeUndefined();
  });

  it('moves a saved stock cue sheet onto Cue Name without touching a custom one', () => {
    const stock = music();
    const temp = stock.columns.find((c) => c.id === 'tempCue')!;
    const cue = stock.columns.find((c) => c.id === 'cueName')!;
    temp.type = 'auto';
    temp.auto = 'cueTitle';
    delete cue.prefill;
    const custom = structuredClone(stock);
    custom.key = 'score';
    custom.columns.find((c) => c.id === 'cueName')!.prefill = 'library';
    const row = (title: string, cueName?: string): Item =>
      ({ id: title, values: cueName ? { cueName } : {}, auto: { cueTitle: title } }) as Item;
    const project = {
      categories: [stock, custom],
      episodes: [{ versions: [{ items: { music: [row('Digital Future'), row('Matador', 'Matador - DonVayei')], score: [row('Leave Me')] } }] }],
    };
    expect(migrateMusicCueColumns(project)).toBe(true);
    expect(temp).toMatchObject({ type: 'text' });
    expect(temp.auto).toBeUndefined();
    expect(cue.prefill).toBe('cueTitle');
    const saved = project.episodes[0].versions[0].items;
    expect(saved.music[0].values.cueName).toBe('Digital Future');
    expect(saved.music[1].values.cueName).toBe('Matador - DonVayei');
    expect(custom.columns.find((c) => c.id === 'tempCue')).toMatchObject({ type: 'auto', auto: 'cueTitle' });
    expect(custom.columns.find((c) => c.id === 'cueName')?.prefill).toBe('library');
    expect(saved.score[0].values.cueName).toBeUndefined();
    expect(migrateMusicCueColumns(project)).toBe(false);
  });

  it('makes a stock Artist column editable and keeps a name already typed', () => {
    const stock = music();
    const artist = stock.columns.find((c) => c.id === 'artist')!;
    artist.type = 'auto';
    artist.auto = 'artist';
    delete artist.prefill;
    const custom = structuredClone(stock);
    custom.key = 'score';
    custom.columns.find((c) => c.id === 'artist')!.type = 'text';
    delete custom.columns.find((c) => c.id === 'artist')!.auto;
    const row = (name: string, typed?: string): Item =>
      ({ id: name, values: typed ? { artist: typed } : {}, auto: { artist: name } }) as Item;
    const project = {
      categories: [stock, custom],
      episodes: [{ versions: [{ items: { music: [row('Ave Air'), row('DonVayei', 'Heyson')], score: [row('Airae')] } }] }],
    };
    expect(migrateArtistColumn(project)).toBe(true);
    expect(artist).toMatchObject({ type: 'combo', prefill: 'artist' });
    expect(artist.auto).toBeUndefined();
    const saved = project.episodes[0].versions[0].items;
    expect(saved.music[0].values.artist).toBe('Ave Air');
    expect(saved.music[1].values.artist).toBe('Heyson');
    expect(custom.columns.find((c) => c.id === 'artist')).toMatchObject({ type: 'text' });
    expect(saved.score[0].values.artist).toBeUndefined();
    expect(migrateArtistColumn(project)).toBe(false);
  });
});
