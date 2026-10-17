/** A parsed subtitle cue. `text` is the lines joined with a single space. */
export interface Cue {
  index: number;
  start_ms: number;
  end_ms: number;
  lines: string[];
  text: string;
}

export type Severity = 'ERROR' | 'WARN' | 'INFO';

/**
 * One hit from the checker. The file is never rewritten from this.
 * `suggestion` is what the UI may apply when the user accepts.
 */
export interface Finding {
  rule_id: string;
  severity: Severity;
  cue_index: number | null;
  message: string;
  context: string;
  suggestion: string | null;
}

export const SEVERITY_ORDER: Record<Severity, number> = { ERROR: 0, WARN: 1, INFO: 2 };
