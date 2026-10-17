import { describe, expect, it } from 'vitest';
import { carryValues } from '../src/core/diff';
import { buildSubtitleItems, parseSRT, srtZeroFrame } from '../src/core/parsers/srt';
import { framesToTC, tcToFrames, type Rate } from '../src/core/timecode';

const TB = 24;
const RATE: Rate = { timebase: TB, ntsc: false };
const PICTURE = tcToFrames('01:00:00:00', TB);

const ZERO_BASED = `1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i>

2
00:00:04,000 --> 00:00:06,000
Second line
keeps going
`;

describe('srt', () => {
  it('reads cues, strips styling, and keeps line breaks', () => {
    const { cues, warnings } = parseSRT(ZERO_BASED);
    expect(warnings).toEqual([]);
    expect(cues.map((c) => c.text)).toEqual(['Hello there', 'Second line\nkeeps going']);
  });

  it('places a file timed from zero onto picture start', () => {
    const { items } = buildSubtitleItems(ZERO_BASED, RATE, srtZeroFrame(TB, PICTURE, TB));
    expect(framesToTC(items[0].recIn, TB)).toBe('01:00:01:00');
    expect(framesToTC(items[0].recOut, TB)).toBe('01:00:03:12');
    expect(framesToTC(items[1].recIn, TB)).toBe('01:00:04:00');
    expect(items[1].auto.subtitle).toBe('Second line\nkeeps going');
    expect(items[1].name).toBe('Second line');
  });

  it('leaves a file that is already in sequence timecode where it is', () => {
    const text = `1
01:00:10:00 --> 01:00:12:12
Already on the sequence

2
00:59:58:00 --> 01:00:00:00
Preroll
`;
    const first = tcToFrames('01:00:10:00', TB);
    expect(srtZeroFrame(first, PICTURE, TB)).toBe(0);
    const { items } = buildSubtitleItems(text, RATE, 0);
    expect(framesToTC(items[0].recIn, TB)).toBe('01:00:10:00');
    expect(framesToTC(items[1].recIn, TB)).toBe('00:59:58:00');
  });

  it('decodes a WebVTT cue the same way', () => {
    const text = `WEBVTT

00:00:02.000 --> 00:00:04.000
Tom &amp; Jerry
`;
    const { items } = buildSubtitleItems(text, RATE, PICTURE);
    expect(items[0].auto.subtitle).toBe('Tom & Jerry');
    expect(framesToTC(items[0].recIn, TB)).toBe('01:00:02:00');
  });

  it('on 23.976, puts a cue on the picture instead of one subtitle late', () => {
    const text = `1
01:02:30,955 --> 01:02:33,875
I was in three finals in college.
`;
    const placed = buildSubtitleItems(text, { timebase: 24, ntsc: true }, 0).items[0];
    const literal = buildSubtitleItems(text, RATE, 0).items[0];
    expect(framesToTC(placed.recIn, 24)).toBe('01:02:27:05');
    expect(literal.recIn - placed.recIn).toBe(90);
  });

  it('warns when nothing in the file is a cue', () => {
    expect(parseSRT('not a subtitle file').warnings).toEqual(['No subtitles found — is this an SRT?']);
  });

  it('carries notes onto the same cue text in the next version', () => {
    const prev = buildSubtitleItems(ZERO_BASED, RATE, PICTURE).items;
    prev[1].values.notes = 'check the spelling';
    const next = buildSubtitleItems(ZERO_BASED.replace('keeps going', 'keeps going'), RATE, PICTURE).items;
    expect(carryValues(prev, next, { looseGenerics: true })).toBe(1);
    expect(next[1].values.notes).toBe('check the spelling');
    const reworded = buildSubtitleItems(ZERO_BASED.replace('Second line\nkeeps going', 'Completely different'), RATE, PICTURE).items;
    carryValues(prev, reworded, { looseGenerics: true });
    expect(reworded.find((i) => i.auto.subtitle === 'Completely different')?.values.notes).toBeUndefined();
  });
});
