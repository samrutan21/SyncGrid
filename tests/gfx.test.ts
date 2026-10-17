import { describe, expect, it } from 'vitest';
import { defaultCategories, defaultSettings } from '../src/core/config/defaults';
import {
  GFX_TEMP_COL,
  GFX_TYPE_COL,
  OSOS_GFX_TYPES,
  gfxTypeLabel,
  gfxTypesOf,
  gfxXlsxLabels,
  isGfxTemp,
  reorderGfxTypes,
  syncGfxColumns,
} from '../src/core/gfxCategories';
import type { Item, ProjectSettings } from '../src/core/types';

function item(type: string, temp = false): Item {
  return {
    id: 'a',
    kind: 'video',
    name: 'Graphic',
    groupKey: 'g',
    recIn: 1,
    recOut: 2,
    tracks: [],
    segments: [],
    auto: {},
    flags: [],
    values: {
      [GFX_TYPE_COL]: type,
      [GFX_TEMP_COL]: { checked: temp },
    },
  };
}

describe('GFX categories', () => {
  it('stays off until OSOS GFX CATEGORIES is selected', () => {
    const settings = defaultSettings();
    expect(gfxTypesOf(settings)).toBeNull();
    expect(gfxXlsxLabels('GFX', settings)).toBeNull();
    const categories = defaultCategories();
    expect(syncGfxColumns(categories, settings)).toBe(false);
    expect(categories.find((c) => c.key === 'gfx')!.columns.some((c) => c.id === GFX_TYPE_COL)).toBe(false);
  });

  it('adds Type and Temp in the OSOS order, then hides them without deleting tags', () => {
    const settings: ProjectSettings = { ...defaultSettings(), gfxCategories: 'osos', gfxTypes: OSOS_GFX_TYPES.map((t) => ({ ...t })) };
    const categories = defaultCategories();
    expect(syncGfxColumns(categories, settings)).toBe(true);
    const cols = categories.find((c) => c.key === 'gfx')!.columns;
    const type = cols.find((c) => c.id === GFX_TYPE_COL)!;
    const names = cols.map((c) => c.id);
    expect(names.indexOf(GFX_TYPE_COL)).toBe(names.indexOf('clipName') + 1);
    expect(names.indexOf(GFX_TEMP_COL)).toBe(names.indexOf(GFX_TYPE_COL) + 1);
    expect(type.options).toEqual(OSOS_GFX_TYPES.map((t) => t.label));
    expect(type.options?.[1]).toBe('Lower Thirds');
    expect(syncGfxColumns(categories, settings)).toBe(false);

    const off = { ...settings, gfxCategories: undefined };
    delete off.gfxCategories;
    expect(syncGfxColumns(categories, off)).toBe(true);
    expect(cols.find((c) => c.id === GFX_TYPE_COL)!.hidden).toBe(true);
    expect(cols.find((c) => c.id === GFX_TEMP_COL)!.hidden).toBe(true);

    const graphic = item('Lower Thirds', true);
    expect(gfxTypeLabel(graphic)).toBe('Lower Thirds');
    expect(isGfxTemp(graphic)).toBe(true);
    expect(isGfxTemp(item('Credits'))).toBe(false);
  });

  it('reorders a category without touching the others', () => {
    const next = reorderGfxTypes(OSOS_GFX_TYPES, 'credits', 'l3');
    expect(next?.map((t) => t.id)).toEqual(['opening', 'credits', 'l3', 'maps', 'weeks', 'bugs', 'locations', 'times', 'standings']);
    expect(reorderGfxTypes(OSOS_GFX_TYPES, 'l3', 'l3')).toBeNull();
    expect(reorderGfxTypes(OSOS_GFX_TYPES, 'l3', 'missing')).toBeNull();
  });

  it('puts the full tracker first, then each category, then Temp', () => {
    const settings: ProjectSettings = { ...defaultSettings(), gfxCategories: 'osos', gfxTypes: [...OSOS_GFX_TYPES, { id: 'bugs-2', label: 'Bug IDs', short: 'Bug IDs' }] };
    expect(gfxXlsxLabels('GFX', settings)).toEqual([
      'GFX',
      'Opening Titles',
      'Lower Thirds',
      'Maps',
      'Game Weeks',
      'Scorebugs',
      'Location IDs',
      'Timestamps',
      'Standings',
      'Credits',
      'Bug IDs',
      'Temp',
    ]);
  });
});
