import { mergeTimelines } from './merge';
import { parseEDL } from './parsers/edl';
import { parseXMEML } from './parsers/xmeml';
import { buildItems } from './pipeline';
import { durationMinSec, durationTC, framesToTC, type Rate } from './timecode';
import type { AutoField, CategoryConfig, CategorySlot, Item, ParsedTimeline, ProjectSettings } from './types';

export interface CategoryImport {
  items: Item[];
  warnings: string[];
  stats: NonNullable<CategorySlot['stats']>;
  rate: Rate;
  seqStartFrame: number | null;
  sequenceName?: string;
  xml?: ParsedTimeline;
  edl?: ParsedTimeline;
}

/**
 * Parse whatever is in a category's slots (XML, EDL or both) and build items.
 * Pure function: no storage, no UI — easy to test and reuse.
 */
export function importCategory(
  slot: Pick<CategorySlot, 'xml' | 'edl' | 'trackFilter'>,
  category: CategoryConfig,
  settings: ProjectSettings,
  domParser?: DOMParser,
): CategoryImport {
  const warnings: string[] = [];
  let xml: ParsedTimeline | undefined;
  let edl: ParsedTimeline | undefined;

  if (slot.xml) {
    xml = parseXMEML(slot.xml.text, domParser);
    warnings.push(...xml.warnings);
  }
  const rate = xml?.rate ?? settings.fallbackRate;
  if (slot.edl) {
    edl = parseEDL(slot.edl.text, rate);
    warnings.push(...edl.warnings);
  }

  const filter = slot.trackFilter?.length ? new Set(slot.trackFilter) : undefined;
  const xmlFiltered: ParsedTimeline | undefined =
    xml && filter ? { ...xml, events: xml.events.filter((e) => e.tracks.some((t) => filter.has(t))) } : xml;

  const merged = mergeTimelines(xmlFiltered, edl);
  warnings.push(...merged.warnings);
  let events = merged.events;
  if (filter && xml && edl) events = events.filter((e) => e.origin !== 'edl');

  const items = buildItems(events, category, settings);
  return {
    items,
    warnings,
    stats: { ...merged.stats, items: items.length },
    rate,
    seqStartFrame: xml?.startFrame ?? null,
    sequenceName: xml?.sequenceName || edl?.sequenceName,
    xml,
    edl,
  };
}

/** Value of an auto column for display/export. */
export function autoValue(item: Item, field: AutoField, rate: Rate): string {
  switch (field) {
    case 'recIn':
      return framesToTC(item.recIn, rate.timebase);
    case 'recOut':
      return framesToTC(item.recOut, rate.timebase);
    case 'duration':
      return durationTC(item.recOut - item.recIn, rate.timebase);
    case 'durationMinSec':
      return durationMinSec(item.recOut - item.recIn, rate);
    case 'srcIn':
      return item.srcIn ?? '';
    case 'srcOut':
      return item.srcOut ?? '';
    case 'segments':
      return String(item.segments.length);
    case 'tracks':
      return item.tracks.join(', ');
    case 'screenshot':
      return '';
    default:
      return item.auto[field] ?? '';
  }
}

/** Suggest a version label from a sequence name: "..._v4_261014_..." → "v4 · 261014". */
export function suggestVersionLabel(sequenceName: string | undefined, fallback: string): string {
  if (!sequenceName) return fallback;
  const v = /(?:^|[_\s-])(v\d+[a-z]?)(?=[_\s-]|$)/i.exec(sequenceName)?.[1];
  const d = /(?:^|[_\s-])(\d{6}|\d{8})(?=[_\s-]|$)/.exec(sequenceName)?.[1];
  if (v && d) return `${v} · ${d}`;
  if (v) return v;
  return fallback;
}

/** Suggest an episode name: "..._EP7_..." → "EP7", "S1_EP7" → "S1 EP7". */
export function suggestEpisodeName(sequenceName: string | undefined): string | undefined {
  if (!sequenceName) return undefined;
  const m = /(S\d+)[_\s-]*(EP?\d+)/i.exec(sequenceName);
  if (m) return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  const e = /(?:^|[_\s-])(EP?\d+)(?=[_\s-]|$)/i.exec(sequenceName);
  return e ? e[1].toUpperCase() : undefined;
}
