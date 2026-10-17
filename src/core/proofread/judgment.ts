import type { Cue, Finding } from './types';

/**
 * JUDGMENT rules need the Spanish audio or an LLM. They are not implemented.
 * Wire a model here later; until then the checker returns nothing for them.
 */
export const JUDGMENT_RULES = [
  {
    rule_id: 'JUDGE-TRANSLATION-FAITHFUL',
    scope: 'cue',
    note: 'Does the English match the Spanish audio? A text checker cannot know.',
  },
  {
    rule_id: 'JUDGE-READS-AWKWARD',
    scope: 'cue',
    note: 'Grammatical but wrong to a native ear. Off until a model is wired.',
  },
  {
    rule_id: 'JUDGE-REGISTER-CONSISTENCY',
    scope: 'file',
    note: 'Same speaker rendered two ways. The SRT does not say who is speaking.',
  },
] as const;

export function checkJudgment(_cues: Cue[]): Finding[] {
  return [];
}
