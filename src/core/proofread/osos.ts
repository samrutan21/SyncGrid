/**
 * OSOS subtitle checker — port of osos_srt_checker.py.
 * The Python file is the source of truth for what fires. This does not edit the SRT.
 */
import ososConfigJson from './osos_config.json';
import { checkJudgment } from './judgment';
import { SEVERITY_ORDER, type Cue, type Finding } from './types';
import { UNICODE_NAMES } from './unicodeNames';

export interface OsosConfig {
  names_people: string[];
  names_teams: string[];
  names_places_orgs: string[];
  allowed_accented: string;
  allowed_curly: string;
  profanity_leave_as_is: string[];
  homophone_sets: string[][];
  number_words: string[];
  ellipsis_house_style: string;
  flag_apostrophe_consistency: boolean;
}

interface PreparedConfig extends OsosConfig {
  name_strings: Set<string>;
  name_tokens: Set<string>;
}

const I_FORMS = new Set(['I', "I'm", "I'll", "I'd", "I've", 'I’m', 'I’ll', 'I’d', 'I’ve']);

const TC = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

export const ososConfig = ososConfigJson as OsosConfig;

export function prepareConfig(cfg: OsosConfig): PreparedConfig {
  const allNames = [...cfg.names_people, ...cfg.names_teams, ...cfg.names_places_orgs];
  const name_tokens = new Set<string>();
  for (const n of allNames) {
    for (const tok of n.match(/[A-Za-zÀ-ÿ']+/gu) ?? []) name_tokens.add(tok);
  }
  return { ...cfg, name_strings: new Set(allNames), name_tokens };
}

function tcToMs(h: string, m: string, s: string, ms: string): number {
  return (Number(h) * 60 + Number(m)) * 60 * 1000 + Number(s) * 1000 + Number(ms);
}

function cueText(lines: string[]): string {
  return lines.map((l) => l.trim()).filter((l) => l).join(' ');
}

/** Parse an SRT. A leading BOM is stripped for parsing and reported separately. */
export function parseSrt(raw: string): { cues: Cue[]; had_bom: boolean } {
  const had_bom = raw.startsWith('\uFEFF');
  if (had_bom) raw = raw.replace(/^\uFEFF+/, '');
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cues: Cue[] = [];
  for (const block of raw.trim().split(/\n\s*\n/)) {
    const ls = block.split('\n');
    const tcIdx = ls.findIndex((l) => TC.test(l));
    if (tcIdx < 0) continue;
    const m = TC.exec(ls[tcIdx]);
    if (!m) continue;
    const prev = tcIdx >= 1 ? ls[tcIdx - 1].trim() : '';
    const lines = ls.slice(tcIdx + 1).filter((l) => l.trim() !== '');
    cues.push({
      index: /^\d+$/.test(prev) ? Number(prev) : cues.length + 1,
      start_ms: tcToMs(m[1], m[2], m[3], m[4]),
      end_ms: tcToMs(m[5], m[6], m[7], m[8]),
      lines,
      text: cueText(lines),
    });
  }
  return { cues, had_bom };
}

function finding(rule_id: string, severity: Finding['severity'], cue_index: number | null, message: string, context = '', suggestion: string | null = null): Finding {
  return { rule_id, severity, cue_index, message, context, suggestion };
}

function ctx(s: string, pos: number, span = 15): string {
  const a = Math.max(0, pos - span);
  const b = Math.min(s.length, pos + span);
  return `…${s.slice(a, b).trim()}…`;
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/** First word of a cue, ignoring an opening quote. */
function openingWord(text: string): string {
  return /^["“‘']*([A-Za-z][\p{L}\p{N}_'’]*)/u.exec(text)?.[1] ?? '';
}

/**
 * The cue already ends a clause, so a following capital is not a missing period.
 * A comma is handled by PUNCT-COMMA-CASE. An ellipsis is not a full stop.
 */
function sentenceClosed(text: string): boolean {
  const core = text.replace(/["”’']+$/u, '');
  if (core.endsWith('...') || core.endsWith('…')) return true;
  const last = core.at(-1) ?? '';
  return last === ',' || last === '.' || last === '!' || last === '?';
}

function isAlpha(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function countSub(s: string, sub: string): number {
  let n = 0;
  let i = 0;
  while (i <= s.length - sub.length) {
    const j = s.indexOf(sub, i);
    if (j < 0) break;
    n++;
    i = j + sub.length;
  }
  return n;
}

function unicodeName(ch: string): string {
  return UNICODE_NAMES[ch.codePointAt(0) ?? 0] ?? '?';
}

function boundaryRe(alts: string[], flags: string): RegExp {
  const body = alts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${body})(?![\\p{L}\\p{N}_])`, flags);
}

function norm(s: string): string {
  return s.replaceAll('’', "'").replaceAll('…', '...').replace(/\s+/g, ' ').trim();
}

export function check(cues: Cue[], hadBom: boolean, cfg: PreparedConfig, masterCues: Cue[] | null = null): Finding[] {
  const F: Finding[] = [];
  const { name_tokens } = cfg;
  const allowed = new Set([...cfg.allowed_accented, ...cfg.allowed_curly]);

  if (hadBom) {
    F.push(finding('STRUCT-BOM', 'INFO', null, 'File begins with a UTF-8 BOM (EF BB BF). Cosmetic for YouTube; remove if a strict parser downstream objects.'));
  }

  cues.forEach((c, n) => {
    const i = n + 1;
    if (c.index !== i) F.push(finding('STRUCT-INDEX', 'ERROR', c.index, `Index out of sequence: expected ${i}, got ${c.index}.`));
  });

  cues.forEach((c, i) => {
    const t = c.text;

    if (c.end_ms <= c.start_ms) {
      F.push(finding('STRUCT-TIMECODE-ORDER', 'ERROR', c.index, 'Cue end is not after its start (reversed or zero-length).'));
    }

    if (i > 0 && c.start_ms < cues[i - 1].end_ms) {
      F.push(finding('STRUCT-OVERLAP', 'WARN', c.index, `Overlaps previous cue by ${cues[i - 1].end_ms - c.start_ms} ms.`));
    }

    for (const ch of t) {
      if (ch.codePointAt(0)! > 127 && !allowed.has(ch) && ch !== '…') {
        const cp = ch.codePointAt(0)!;
        F.push(finding('STRUCT-HIDDEN-CHAR', 'WARN', c.index, `Unexpected non-ASCII char U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${unicodeName(ch)}).`, t));
        break;
      }
    }

    for (const m of t.matchAll(/([.!?])(["”’]?)\s+([A-Za-z])/g)) {
      const dotPos = m.index ?? 0;
      if (m[1] === '.' && t.slice(Math.max(0, dotPos - 2), dotPos + 1) === '...') continue;
      if (!isUpper(m[3])) {
        F.push(finding('PUNCT-PERIOD-CASE', 'ERROR', c.index, 'Lowercase letter after sentence-ending punctuation.', ctx(t, dotPos + m[0].length - 1)));
      }
    }

    for (const m of t.matchAll(/,\s+([A-Za-z][\p{L}\p{N}_'’]*)/gu)) {
      const w = m[1];
      const wordStart = (m.index ?? 0) + m[0].length - w.length;
      if (isUpper(w[0]) && !I_FORMS.has(w) && !name_tokens.has(w)) {
        F.push(
          finding(
            'PUNCT-COMMA-CASE',
            'ERROR',
            c.index,
            `Capitalized "${w}" after a comma (not "I" or a known name).`,
            ctx(t, wordStart),
            t.slice(0, wordStart) + w[0].toLowerCase() + w.slice(1) + t.slice(wordStart + w.length),
          ),
        );
      }
    }

    for (const m of t.matchAll(/\s+([,.!?;:])/g)) {
      F.push(finding('PUNCT-SPACE-BEFORE', 'ERROR', c.index, `Space before "${m[1]}".`, ctx(t, m.index ?? 0), t.replace(/\s+([,.!?;:])/g, '$1')));
    }

    for (const line of c.lines) {
      if (/\S {2,}\S/.test(line)) {
        F.push(finding('PUNCT-DOUBLE-SPACE', 'WARN', c.index, 'Two or more consecutive spaces.', line, line.replace(/ {2,}/g, ' ')));
        break;
      }
    }

    for (const line of c.lines) {
      if (line !== line.trimEnd()) {
        F.push(finding('PUNCT-TRAILING-SPACE', 'INFO', c.index, 'Trailing space at end of line.', repr(line), line.trimEnd()));
        break;
      }
    }

    if (t.includes('…')) {
      F.push(finding('PUNCT-ELLIPSIS-GLYPH', 'INFO', c.index, 'Single-glyph ellipsis …; house style is three dots ...', t, t.replaceAll('…', '...')));
    }

    for (const m of t.matchAll(/(?<![\p{L}\p{N}_])([\p{L}\p{N}_]+)\s+\1(?![\p{L}\p{N}_])/giu)) {
      F.push(finding('WORD-REPEAT', 'WARN', c.index, `Repeated word "${m[1]}".`, ctx(t, m.index ?? 0)));
    }

    for (const m of t.matchAll(/[a-z]{2,}[A-Z][a-z]{2,}/g)) {
      if (!name_tokens.has(m[0])) F.push(finding('WORD-JOIN', 'WARN', c.index, `Possible missing space: "${m[0]}".`, ctx(t, m.index ?? 0)));
    }

    for (const group of cfg.homophone_sets) {
      for (const m of t.matchAll(boundaryRe(group, 'giu'))) {
        F.push(finding('HOMOPHONE', 'INFO', c.index, `Confusable "${m[1]}" — verify.`, ctx(t, m.index ?? 0)));
      }
    }

    if (/\d/.test(t)) {
      F.push(finding('NUMERAL-CONVENTION', 'INFO', c.index, 'Contains a numeral — confirm it is a football stat (numerals OK) not narrative.', t));
    }
    const nw = [...t.matchAll(boundaryRe(cfg.number_words, 'giu'))].map((m) => m[1]);
    if (nw.length) {
      F.push(finding('NUMERAL-CONVENTION', 'INFO', c.index, `Contains spelled-out number(s) ${pyList(nw)} — confirm narrative (words OK) not a stat.`, t));
    }
  });

  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1].text.trimEnd();
    const cur = cues[i].text;
    if (!prev || !cur) continue;
    if ('.!?'.includes(prev.at(-1) ?? '') && isAlpha(cur[0]) && !isUpper(cur[0]) && !prev.endsWith('...')) {
      F.push(finding('PUNCT-PERIOD-CASE', 'ERROR', cues[i].index, `Cue starts lowercase after previous cue ended in "${prev.at(-1)}".`, `…${prev.slice(-18)}  ||  ${cur.slice(0, 18)}…`));
    }
    if (prev.endsWith(',')) {
      const w = /^([A-Za-z][\p{L}\p{N}_'’]*)/u.exec(cur)?.[1] ?? cur[0];
      if (isUpper(cur[0]) && !I_FORMS.has(w) && !name_tokens.has(w)) {
        F.push(finding('PUNCT-COMMA-CASE', 'ERROR', cues[i].index, `Cue starts with capitalized "${w}" after previous cue ended in a comma.`, `…${prev.slice(-18)}  ||  ${cur.slice(0, 22)}…`));
      }
    }
    const word = openingWord(cur);
    if (word && isUpper(word[0]) && !I_FORMS.has(word) && !name_tokens.has(word) && !sentenceClosed(prev)) {
      F.push(
        finding(
          'PUNCT-MISSING-PERIOD',
          'ERROR',
          cues[i - 1].index,
          `Missing period before capitalized "${word}".`,
          `…${prev.slice(-18)}  ||  ${cur.slice(0, 22)}…`,
          `${prev}.`,
        ),
      );
    }
  }

  const joined = cues.map((c) => c.text).join(' ');
  const three = countSub(joined, '...');
  const glyph = countSub(joined, '…');
  if (three && glyph) {
    F.push(finding('PUNCT-ELLIPSIS-CONSISTENCY', 'INFO', null, `File mixes ellipsis styles: ${three}×'...' and ${glyph}×'…'. House style is '...'.`));
  }

  if (masterCues) {
    const masterLines = new Set<string>();
    for (const mc of masterCues) {
      for (const l of mc.lines) if (l.trim()) masterLines.add(norm(l));
      masterLines.add(norm(mc.text));
    }
    const masterBlob = norm(masterCues.map((mc) => mc.text).join(' '));
    for (const c of cues) {
      const key = norm(c.text);
      if (!masterLines.has(key) && !masterBlob.includes(key)) {
        F.push(finding('XREF-AGAINST-LOCKED', 'WARN', c.index, 'Cue text not found verbatim in the locked master (new line or retype error?).', c.text));
      }
    }
  }

  return F;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** One substitution, or one insertion. Exact strings are not misses. */
export function editDistance1(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
  }
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      diff++;
      j++;
      if (diff > 1) return false;
    }
  }
  return true;
}

export function checkNameSpelling(cues: Cue[], cfg: PreparedConfig): Finding[] {
  const F: Finding[] = [];
  const nameTokens = new Set([...cfg.name_tokens].filter((t) => t.length >= 4 && isUpper(t[0])));
  const accentMap = new Map<string, string>();
  for (const t of nameTokens) {
    const bare = stripAccents(t);
    if (!accentMap.has(bare)) accentMap.set(bare, t);
  }
  for (const c of cues) {
    for (const m of c.text.matchAll(/(?<![\p{L}\p{N}_])([A-Z][A-Za-zÀ-ÿ']{3,})(?![\p{L}\p{N}_])/gu)) {
      const tok = m[1];
      if (nameTokens.has(tok)) continue;
      const bare = stripAccents(tok);
      const accented = accentMap.get(bare);
      if (accented && accented !== tok) {
        F.push(finding('NAME-SPELLING', 'ERROR', c.index, `"${tok}" looks like "${accented}" with an accent dropped/changed.`, ctx(c.text, m.index ?? 0), accented));
        continue;
      }
      for (const correct of nameTokens) {
        if (editDistance1(tok, correct)) {
          F.push(finding('NAME-SPELLING', 'ERROR', c.index, `"${tok}" may be a misspelling of "${correct}".`, ctx(c.text, m.index ?? 0), correct));
          break;
        }
      }
    }
  }
  return F;
}

/** Python repr() of a list of strings: ['two', 'three']. */
function pyList(words: string[]): string {
  return `[${words.map((w) => `'${w}'`).join(', ')}]`;
}

/** Python repr() of a string, used as the trailing-space context. */
function repr(line: string): string {
  return `'${line.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/**
 * Run the deterministic checker. Judgment rules are consulted and currently add nothing.
 * Pass a different config to use another show's lists. Nothing here writes the file.
 */
export function proofread(raw: string, cfg: OsosConfig = ososConfig, masterRaw?: string | null): Finding[] {
  const prepared = prepareConfig(cfg);
  const { cues, had_bom } = parseSrt(raw);
  const master = masterRaw ? parseSrt(masterRaw).cues : null;
  const findings = [...check(cues, had_bom, prepared, master), ...checkNameSpelling(cues, prepared), ...checkJudgment(cues)];
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.cue_index ?? 0) - (b.cue_index ?? 0));
  return findings;
}

/**
 * The cue text with every suggestion applied, for display only.
 * Returns null when nothing would change. The stored SRT is not touched.
 */
export function proposedText(text: string, findings: Finding[]): string | null {
  let lines = text.split('\n');
  let changed = false;
  for (const finding of findings) {
    if (!finding.suggestion) continue;
    const next = rewriteLines(lines, finding);
    if (!next || next.join('\n') === lines.join('\n')) continue;
    lines = next;
    changed = true;
  }
  return changed ? lines.join('\n') : null;
}

/**
 * Apply one suggestion to a raw SRT string. Used to build the proposed line.
 * Callers that display a correction must not write this back over the original.
 */
export function applySuggestion(raw: string, finding: Finding): string | null {
  if (!finding.suggestion || finding.cue_index == null) return null;
  const { cues } = parseSrt(raw);
  const cue = cues.find((c) => c.index === finding.cue_index);
  if (!cue) return null;
  const next = rewriteLines(cue.lines, finding);
  if (!next || next.join('\n') === cue.lines.join('\n')) return null;
  return replaceCueLines(raw, finding.cue_index, next);
}

function rewriteLines(lines: string[], finding: Finding): string[] | null {
  const suggestion = finding.suggestion ?? '';
  if (finding.rule_id === 'NAME-SPELLING' || finding.rule_id === 'PUNCT-COMMA-CASE') {
    const bad = /^"([^"]+)"|^Capitalized "([^"]+)"/.exec(finding.message);
    const token = bad?.[1] ?? bad?.[2];
    if (!token) return null;
    const replacement = finding.rule_id === 'NAME-SPELLING' ? suggestion : token[0].toLowerCase() + token.slice(1);
    return replaceToken(lines, token, replacement);
  }
  if (finding.rule_id === 'PUNCT-DOUBLE-SPACE') {
    const i = lines.findIndex((l) => l === finding.context);
    if (i < 0) return null;
    const copy = lines.slice();
    copy[i] = suggestion;
    return copy;
  }
  if (finding.rule_id === 'PUNCT-TRAILING-SPACE') {
    const i = lines.findIndex((l) => l !== l.trimEnd());
    if (i < 0) return null;
    const copy = lines.slice();
    copy[i] = lines[i].trimEnd();
    return copy;
  }
  if (finding.rule_id === 'PUNCT-SPACE-BEFORE') return lines.map((l) => l.replace(/\s+([,.!?;:])/g, '$1'));
  if (finding.rule_id === 'PUNCT-ELLIPSIS-GLYPH') return lines.map((l) => l.replaceAll('…', '...'));
  if (finding.rule_id === 'PUNCT-MISSING-PERIOD') {
    const copy = lines.slice();
    let i = copy.length - 1;
    while (i > 0 && copy[i].trim() === '') i--;
    if (i < 0 || sentenceClosed(copy[i].trimEnd())) return null;
    copy[i] = copy[i].trimEnd() + '.';
    return copy;
  }
  return lines.length === 1 ? [suggestion] : null;
}

function replaceToken(lines: string[], token: string, replacement: string): string[] | null {
  const source = `(?<![\\p{L}\\p{N}_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`;
  let hit = false;
  const next = lines.map((line) => {
    if (hit) return line;
    const line2 = line.replace(new RegExp(source, 'u'), replacement);
    if (line2 !== line) hit = true;
    return line2;
  });
  return hit ? next : null;
}

function replaceCueLines(raw: string, cueIndex: number, nextLines: string[]): string | null {
  const hadBom = raw.startsWith('\uFEFF');
  let text = hadBom ? raw.slice(1) : raw;
  const crlf = text.includes('\r\n');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.trim().split(/\n\s*\n/);
  let seq = 0;
  let hit = false;
  const rebuilt = blocks.map((block) => {
    const ls = block.split('\n');
    const tcIdx = ls.findIndex((l) => TC.test(l));
    if (tcIdx < 0) return block;
    seq += 1;
    const prev = tcIdx >= 1 ? ls[tcIdx - 1].trim() : '';
    const index = /^\d+$/.test(prev) ? Number(prev) : seq;
    if (index !== cueIndex) return block;
    hit = true;
    return [...ls.slice(0, tcIdx + 1), ...nextLines].join('\n');
  });
  if (!hit) return null;
  let out = `${rebuilt.join('\n\n')}\n`;
  if (crlf) out = out.replace(/\n/g, '\r\n');
  return hadBom ? `\uFEFF${out}` : out;
}
