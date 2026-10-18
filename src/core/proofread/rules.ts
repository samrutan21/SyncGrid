import { plainCue } from '../parsers/srt';
import type { Item } from '../types';
import { ososConfig, parseSrt, proofread, type OsosConfig } from './osos';
import type { Finding } from './types';

/** Named proofreading passes. Off runs nothing. Another show is another entry. */
export const SUBTITLE_RULE_SETS = [
  { id: 'off', label: 'Off' },
  { id: 'osos', label: 'OSOS SUBS' },
] as const;

export type SubtitleRuleId = (typeof SUBTITLE_RULE_SETS)[number]['id'];

export function activeRuleSet(id: string | undefined): SubtitleRuleId {
  return SUBTITLE_RULE_SETS.some((s) => s.id === id) ? (id as SubtitleRuleId) : 'off';
}

export interface SubtitleCheck {
  byItem: Map<string, Finding[]>;
  file: Finding[];
}

const EMPTY: SubtitleCheck = { byItem: new Map(), file: [] };

/** A rule file uses the same shape as the OSOS config. Missing house lists fall back to that config. */
export function parseRuleConfig(value: unknown): OsosConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const names = ['names_people', 'names_teams', 'names_places_orgs'] as const;
  if (!names.some((k) => Array.isArray(o[k])) && !Array.isArray(o.homophone_sets)) return null;
  const strings = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : fallback);
  const groups = (v: unknown) =>
    Array.isArray(v) && v.every((g) => Array.isArray(g) && g.length > 0 && g.every((x) => typeof x === 'string')) ? (v as string[][]) : ososConfig.homophone_sets;
  const words = strings(o.number_words, ososConfig.number_words);
  return {
    names_people: strings(o.names_people, []),
    names_teams: strings(o.names_teams, []),
    names_places_orgs: strings(o.names_places_orgs, []),
    allowed_accented: typeof o.allowed_accented === 'string' ? o.allowed_accented : ososConfig.allowed_accented,
    allowed_curly: typeof o.allowed_curly === 'string' ? o.allowed_curly : ososConfig.allowed_curly,
    profanity_leave_as_is: strings(o.profanity_leave_as_is, ososConfig.profanity_leave_as_is),
    homophone_sets: groups(o.homophone_sets),
    number_words: words.length ? words : ososConfig.number_words,
    ellipsis_house_style: typeof o.ellipsis_house_style === 'string' ? o.ellipsis_house_style : ososConfig.ellipsis_house_style,
    flag_apostrophe_consistency: typeof o.flag_apostrophe_consistency === 'boolean' ? o.flag_apostrophe_consistency : ososConfig.flag_apostrophe_consistency,
  };
}

/** Run the selected pass and pair each finding with the subtitle row it belongs to. */
export function subtitleCheck(raw: string | undefined, items: Item[] | undefined, ruleId: string | undefined, config?: OsosConfig): SubtitleCheck {
  if (!raw || !ruleId || ruleId === 'off') return EMPTY;
  if (ruleId !== 'osos' && !config) return EMPTY;
  const { cues } = parseSrt(raw);
  const findings = proofread(raw, config ?? ososConfig);
  const kept = cues.filter((c) => c.end_ms > c.start_ms);
  const pool = (items ?? []).filter((it) => !it.manual).slice().sort((a, b) => a.recIn - b.recIn || a.recOut - b.recOut);
  const idByIndex = new Map<number, string>();
  for (const cue of kept) {
    const body = plainCue(cue.lines.join('\n'));
    if (!body) continue;
    const i = pool.findIndex((it) => plainCue(it.auto.subtitle ?? '') === body);
    if (i < 0) continue;
    idByIndex.set(cue.index, pool[i].id);
    pool.splice(i, 1);
  }
  const byItem = new Map<string, Finding[]>();
  const file: Finding[] = [];
  for (const f of findings) {
    if (f.cue_index == null) {
      file.push(f);
      continue;
    }
    const id = idByIndex.get(f.cue_index);
    if (!id) continue;
    const list = byItem.get(id) ?? [];
    list.push(f);
    byItem.set(id, list);
  }
  return { byItem, file };
}
