import { plainCue } from '../parsers/srt';
import type { Item } from '../types';
import { parseSrt, proofread } from './osos';
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

/** Run the selected pass and pair each finding with the subtitle row it belongs to. */
export function subtitleCheck(raw: string | undefined, items: Item[] | undefined, ruleId: string | undefined): SubtitleCheck {
  if (activeRuleSet(ruleId) !== 'osos' || !raw) return EMPTY;
  const { cues } = parseSrt(raw);
  const findings = proofread(raw);
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
