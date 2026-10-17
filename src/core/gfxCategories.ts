import type { CategoryConfig, CheckValue, ColumnDef, Item, ProjectSettings } from './types';

/** A GFX type within a project. `short` is the tab and sidebar label. */
export interface GfxType {
  id: string;
  label: string;
  short: string;
}

/** Named GFX category sets. Off shows one tracker. Another show is another entry. */
export const GFX_CATEGORY_SETS = [
  { id: 'off', label: 'Off' },
  { id: 'osos', label: 'OSOS GFX CATEGORIES' },
] as const;

export const OSOS_GFX_TYPES: GfxType[] = [
  { id: 'opening', label: 'Opening Titles', short: 'Titles' },
  { id: 'l3', label: 'Lower Thirds', short: 'L3s' },
  { id: 'maps', label: 'Maps', short: 'Maps' },
  { id: 'weeks', label: 'Game Weeks', short: 'Weeks' },
  { id: 'bugs', label: 'Scorebugs', short: 'Bugs' },
  { id: 'locations', label: 'Location IDs', short: 'Locations' },
  { id: 'times', label: 'Timestamps', short: 'Times' },
  { id: 'standings', label: 'Standings', short: 'Standings' },
  { id: 'credits', label: 'Credits', short: 'Credits' },
];

export const GFX_TYPE_COL = 'gfxType';
export const GFX_TEMP_COL = 'gfxTemp';

/** The project's type list, or null when GFX categories are off. */
export function gfxTypesOf(settings: ProjectSettings): GfxType[] | null {
  if (settings.gfxCategories !== 'osos') return null;
  return settings.gfxTypes?.length ? settings.gfxTypes : OSOS_GFX_TYPES;
}

export function gfxTypeLabel(item: Item): string {
  const v = item.values[GFX_TYPE_COL];
  return typeof v === 'string' ? v : '';
}

export function isGfxTemp(item: Item): boolean {
  const v = item.values[GFX_TEMP_COL];
  if (v === true) return true;
  if (v && typeof v === 'object' && !Array.isArray(v)) return !!(v as CheckValue).checked;
  return false;
}

/** Move `id` to sit just before `beforeId`. Returns null when nothing changes. */
export function reorderGfxTypes(types: GfxType[], id: string, beforeId: string): GfxType[] | null {
  if (!id || id === beforeId) return null;
  const from = types.findIndex((t) => t.id === id);
  if (from < 0) return null;
  const next = types.slice();
  const [item] = next.splice(from, 1);
  const to = next.findIndex((t) => t.id === beforeId);
  if (to < 0) return null;
  next.splice(to, 0, item);
  return next;
}

/** Sheet names for an Excel export of this GFX tracker. Null keeps a single sheet. */
export function gfxXlsxLabels(main: string, settings: ProjectSettings): string[] | null {
  const types = gfxTypesOf(settings);
  if (!types) return null;
  return [main, ...types.map((t) => t.label), 'Temp'];
}

/**
 * Show the Type and Temp columns while a category set is on, and hide them
 * when it is off. Existing tags stay on the item either way.
 * Returns whether the category list changed.
 */
export function syncGfxColumns(categories: CategoryConfig[], settings: ProjectSettings): boolean {
  const gfx = categories.find((c) => c.key === 'gfx');
  if (!gfx) return false;
  const types = gfxTypesOf(settings);
  const typeCol = gfx.columns.find((c) => c.id === GFX_TYPE_COL);
  const tempCol = gfx.columns.find((c) => c.id === GFX_TEMP_COL);
  if (!types) {
    let changed = false;
    for (const col of [typeCol, tempCol]) {
      if (col && !col.hidden) {
        col.hidden = true;
        changed = true;
      }
    }
    return changed;
  }
  const options = types.map((t) => t.label);
  let changed = false;
  if (!typeCol) {
    insertAfter(gfx.columns, column(GFX_TYPE_COL, 'Type', 'select', { options, width: 1.3 }), 'clipName');
    changed = true;
  } else if (typeCol.hidden || !sameList(typeCol.options, options)) {
    typeCol.hidden = false;
    typeCol.options = options;
    changed = true;
  }
  if (!tempCol) {
    insertAfter(gfx.columns, column(GFX_TEMP_COL, 'Temp', 'checkbox', { width: 0.7 }), GFX_TYPE_COL);
    changed = true;
  } else if (tempCol.hidden) {
    tempCol.hidden = false;
    changed = true;
  }
  return changed;
}

function column(id: string, label: string, type: ColumnDef['type'], extra: Partial<ColumnDef>): ColumnDef {
  return { id, label, type, ...extra };
}

function insertAfter(columns: ColumnDef[], col: ColumnDef, afterId: string) {
  const at = columns.findIndex((c) => c.id === afterId);
  columns.splice(at >= 0 ? at + 1 : columns.length, 0, col);
}

function sameList(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}
