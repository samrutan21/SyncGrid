import { describe, expect, it } from 'vitest';
import { buildSubtitleItems } from '../src/core/parsers/srt';
import { applySuggestion, proofread, proposedText } from '../src/core/proofread/osos';
import { parseRuleConfig, subtitleCheck } from '../src/core/proofread/rules';
import type { Finding } from '../src/core/proofread/types';
import type { Rate } from '../src/core/timecode';

/** EP7 cues 1–9, from the spec. A correct comma and "day by day" must not fire. */
const CLEAN = `1
01:00:12,900 --> 01:00:17,614
We want to be champions because they deserve it,

2
01:00:17,614 --> 01:00:22,243
because they are a team that has been resilient,
and has known how to work.

3
01:00:23,286 --> 01:00:27,165
In past years, a reporter asked me

4
01:00:27,165 --> 01:00:33,963
whether you could still instill values in a mature team,
a professional team.

5
01:00:34,339 --> 01:00:38,968
I think we're all people. The players as much as the coaches.

6
01:00:38,968 --> 01:00:41,262
And I think day by day we keep learning.

7
01:00:41,763 --> 01:00:43,264
We have to keep learning about values,

8
01:00:43,264 --> 01:00:45,600
we have to keep learning about things.

9
01:00:46,017 --> 01:00:51,397
An important value is teamwork.
I think that's what matters, being a family.
`;

/**
 * Broken on purpose: "We" after a comma, Tristan, Arcangeles,
 * a space before the period, a double space, and "to to".
 * "day by day" and "Tommy" after a comma must stay clean.
 */
const BROKEN = `1
00:00:01,000 --> 00:00:03,000
a bit more of a passing team,

2
00:00:03,000 --> 00:00:05,000
We know we have a weapon.

3
00:00:05,500 --> 00:00:08,000
Tristan Wallace played for Arcangeles.

4
00:00:08,500 --> 00:00:11,000
We need  to to make the play .

5
00:00:11,500 --> 00:00:13,000
And I think day by day we keep learning.

6
00:00:13,500 --> 00:00:16,000
On the right side, Tommy Auger along with Tristen Wallace.
`;

const CLEAN_FINDINGS: Finding[] = [
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 1, message: 'Confusable "to" — verify.', context: '…We want to be champions…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 2, message: 'Confusable "to" — verify.', context: '…has known how to work.…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 3, message: 'Confusable "past" — verify.', context: '…In past years, a r…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 4, message: 'Confusable "whether" — verify.', context: '…whether you cou…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 5, message: 'Confusable "we\'re" — verify.', context: '…I think we\'re all peopl…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 7, message: 'Confusable "to" — verify.', context: '…We have to keep learnin…', suggestion: null },
  { rule_id: 'HOMOPHONE', severity: 'INFO', cue_index: 8, message: 'Confusable "to" — verify.', context: '…we have to keep learnin…', suggestion: null },
];

const BROKEN_FINDINGS: Finding[] = [
  {
    rule_id: 'PUNCT-COMMA-CASE',
    severity: 'ERROR',
    cue_index: 2,
    message: 'Cue starts with capitalized "We" after previous cue ended in a comma.',
    context: '…of a passing team,  ||  We know we have a weap…',
    suggestion: null,
  },
  {
    rule_id: 'NAME-SPELLING',
    severity: 'ERROR',
    cue_index: 3,
    message: '"Tristan" may be a misspelling of "Tristen".',
    context: '…Tristan Wallace…',
    suggestion: 'Tristen',
  },
  {
    rule_id: 'NAME-SPELLING',
    severity: 'ERROR',
    cue_index: 3,
    message: '"Arcangeles" looks like "Arcángeles" with an accent dropped/changed.',
    context: '…ace played for Arcangeles.…',
    suggestion: 'Arcángeles',
  },
  {
    rule_id: 'PUNCT-SPACE-BEFORE',
    severity: 'ERROR',
    cue_index: 4,
    message: 'Space before ".".',
    context: '…o make the play .…',
    suggestion: 'We need  to to make the play.',
  },
  {
    rule_id: 'PUNCT-DOUBLE-SPACE',
    severity: 'WARN',
    cue_index: 4,
    message: 'Two or more consecutive spaces.',
    context: 'We need  to to make the play .',
    suggestion: 'We need to to make the play .',
  },
  {
    rule_id: 'WORD-REPEAT',
    severity: 'WARN',
    cue_index: 4,
    message: 'Repeated word "to".',
    context: '…We need  to to make the…',
    suggestion: null,
  },
  {
    rule_id: 'HOMOPHONE',
    severity: 'INFO',
    cue_index: 4,
    message: 'Confusable "to" — verify.',
    context: '…We need  to to make the…',
    suggestion: null,
  },
  {
    rule_id: 'HOMOPHONE',
    severity: 'INFO',
    cue_index: 4,
    message: 'Confusable "to" — verify.',
    context: '…We need  to to make the pla…',
    suggestion: null,
  },
];

describe('OSOS subtitle checker', () => {
  it('EP7 cues 1–9 produce 0 ERROR and 0 WARN', () => {
    const findings = proofread(CLEAN);
    expect(findings.filter((f) => f.severity === 'ERROR' || f.severity === 'WARN')).toEqual([]);
    expect(findings.some((f) => f.rule_id === 'WORD-REPEAT')).toBe(false);
    expect(findings.some((f) => f.rule_id === 'PUNCT-COMMA-CASE')).toBe(false);
    expect(findings.some((f) => f.rule_id.startsWith('JUDGE-'))).toBe(false);
    expect(findings).toEqual(CLEAN_FINDINGS);
  });

  it('flags the broken cues and leaves "day by day" and Tommy alone', () => {
    const findings = proofread(BROKEN);
    expect(findings).toEqual(BROKEN_FINDINGS);
    expect(findings.some((f) => f.rule_id === 'WORD-REPEAT' && f.context.includes('day by day'))).toBe(false);
    expect(findings.some((f) => f.rule_id === 'PUNCT-COMMA-CASE' && f.cue_index === 6)).toBe(false);
    expect(findings.find((f) => f.rule_id === 'PUNCT-COMMA-CASE')?.message).toContain('"We"');
    expect(findings.filter((f) => f.rule_id === 'NAME-SPELLING').map((f) => f.suggestion)).toEqual(['Tristen', 'Arcángeles']);
  });

  it('accepts one suggestion and leaves the other cues alone', () => {
    const tristan = proofread(BROKEN).find((f) => f.suggestion === 'Tristen')!;
    const next = applySuggestion(BROKEN, tristan);
    expect(next).toContain('Tristen Wallace played for Arcangeles.');
    expect(next).not.toContain('Tristan');
    const again = proofread(next!);
    expect(again.some((f) => f.message.includes('Tristan'))).toBe(false);
    expect(again.some((f) => f.rule_id === 'PUNCT-COMMA-CASE')).toBe(true);
    expect(again.some((f) => f.message.includes('Arcangeles'))).toBe(true);
    expect(applySuggestion(BROKEN, again.find((f) => f.rule_id === 'PUNCT-COMMA-CASE')!)).toBeNull();

    const rate: Rate = { timebase: 24, ntsc: false };
    const items = buildSubtitleItems(BROKEN, rate, 0).items;
    const on = subtitleCheck(BROKEN, items, 'osos');
    expect(on.byItem.get(items[1].id)?.some((f) => f.message.includes('"We"'))).toBe(true);
    expect(subtitleCheck(BROKEN, items, 'off').byItem.size).toBe(0);
  });

  it('does not move a deleted cue’s finding onto the next subtitle', () => {
    const raw = `1
01:16:50,000 --> 01:16:53,000
The Mexican team will stop

2
01:16:53,200 --> 01:16:57,170
10-6, the Monterrey Osos are winning
`;
    const rate: Rate = { timebase: 24, ntsc: false };
    const items = buildSubtitleItems(raw, rate, 0).items;
    const both = subtitleCheck(raw, items, 'osos');
    expect(both.byItem.get(items[0].id)?.some((f) => f.message.includes('"Mexican"'))).toBe(true);
    expect(both.byItem.get(items[1].id)?.some((f) => f.message.includes('"Mexican"'))).toBe(false);
    const kept = subtitleCheck(raw, [items[1]], 'osos');
    expect(kept.byItem.get(items[1].id)?.some((f) => f.message.includes('"Mexican"')) ?? false).toBe(false);
  });

  it('flags a missing period when the next cue starts a new sentence', () => {
    const raw = `1
01:21:43,130 --> 01:21:44,000
He has time

2
01:21:44,080 --> 01:21:46,140
The pass is complete,

3
01:21:46,140 --> 01:21:48,000
to throw it.

4
01:21:48,000 --> 01:21:50,000
played for

5
01:21:50,000 --> 01:21:52,000
Tristen Wallace scored.

6
01:21:52,000 --> 01:21:54,000
He has time.

7
01:21:54,000 --> 01:21:56,000
The pass is complete.

8
01:21:56,000 --> 01:21:58,000
He has time.

9
01:21:58,000 --> 01:22:00,000
the pass is complete.

10
01:22:00,000 --> 01:22:02,000
a bit more of a passing team,

11
01:22:02,000 --> 01:22:04,000
We know we have a weapon.

12
01:22:04,000 --> 01:22:06,000
He has time...

13
01:22:06,000 --> 01:22:08,000
The pass is complete.
`;
    const findings = proofread(raw);
    const missing = findings.filter((f) => f.rule_id === 'PUNCT-MISSING-PERIOD');
    expect(missing).toEqual([
      {
        rule_id: 'PUNCT-MISSING-PERIOD',
        severity: 'ERROR',
        cue_index: 1,
        message: 'Missing period before capitalized "The".',
        context: '…He has time  ||  The pass is complete,…',
        suggestion: 'He has time.',
      },
    ]);
    expect(findings.some((f) => f.rule_id === 'PUNCT-PERIOD-CASE' && f.cue_index === 9)).toBe(true);
    expect(findings.some((f) => f.rule_id === 'PUNCT-COMMA-CASE' && f.message.includes('"We"'))).toBe(true);
    expect(findings.some((f) => f.rule_id === 'PUNCT-MISSING-PERIOD' && (f.cue_index === 4 || f.cue_index === 10 || f.cue_index === 12))).toBe(false);
    expect(proposedText('He has time', missing)).toBe('He has time.');
  });

  it('keeps Jiya Wright capitalized after a comma', () => {
    const findings = proofread(`1
01:16:04,190 --> 01:16:06,240
The runner, Jiya Wright.
`);
    expect(findings.some((f) => f.rule_id === 'PUNCT-COMMA-CASE')).toBe(false);
    expect(findings.some((f) => f.severity === 'ERROR')).toBe(false);
  });

  it('accepts a subtitle rule file and ignores anything else', () => {
    expect(parseRuleConfig({ names_people: ['Ada Lovelace'] })?.names_people).toEqual(['Ada Lovelace']);
    expect(parseRuleConfig({ hello: 'no' })).toBeNull();
    expect(subtitleCheck('1\n00:00:01,000 --> 00:00:02,000\nHello.\n', [], 'skylab').byItem.size).toBe(0);
  });

  it('shows a corrected line and leaves the original text intact', () => {
    const original = 'Tristan Wallace played for Arcangeles.';
    const findings = proofread(BROKEN).filter((f) => f.cue_index === 3);
    expect(proposedText(original, findings)).toBe('Tristen Wallace played for Arcángeles.');
    expect(proofread(BROKEN).some((f) => f.message.includes('Tristan'))).toBe(true);
  });
});
