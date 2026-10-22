import type { CategoryConfig, ColumnDef, Item, ProjectSettings } from '../types';

/**
 * Default categories and columns. These are only starting points: every
 * project can add, remove, rename and reorder columns, add categories, and
 * save its own setup as a template.
 */

export const GFX_STATUS = ['Not started', 'In progress', 'In review', 'Approved', 'Final'];
export const APPROVAL = ['Pending', 'Approved', 'Needs replacement', 'Cleared'];

const c = (id: string, label: string, type: ColumnDef['type'], extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  label,
  type,
  ...extra,
});

export function defaultCategories(): CategoryConfig[] {
  return [
    {
      key: 'gfx',
      label: 'GFX',
      color: '#ff8a1f',
      grouping: 'adjacent',
      gapFrames: 6,
      extractArchivalIds: false,
      screenshotAt: 'mid',
      columns: [
        c('screenshot', 'Screenshot', 'auto', { auto: 'screenshot', width: 1.4 }),
        c('recIn', 'Sequence TC In', 'auto', { auto: 'recIn', width: 1.1 }),
        c('recOut', 'Sequence TC Out', 'auto', { auto: 'recOut', width: 1.1 }),
        c('duration', 'Duration', 'auto', { auto: 'duration', width: 1 }),
        c('clipName', 'Clip Name', 'auto', { auto: 'clipName', width: 2.6 }),
        c('text', 'Text', 'longtext', { width: 2.2 }),
        c('resolution', 'Source Resolution', 'auto', { auto: 'resolution', width: 1 }),
        c('note', 'Note', 'longtext', { width: 2 }),
        c('status', 'Status', 'status', { options: GFX_STATUS, width: 1 }),
      ],
    },
    {
      key: 'music',
      label: 'Cue Sheet',
      color: '#4ea8ff',
      grouping: 'music',
      gapFrames: 12,
      extractArchivalIds: false,
      screenshotAt: 'in',
      columns: [
        c('recIn', 'TC In', 'auto', { auto: 'recIn', width: 1.1 }),
        c('recOut', 'TC Out', 'auto', { auto: 'recOut', width: 1.1 }),
        c('duration', 'Duration (min:sec)', 'auto', { auto: 'durationMinSec', width: 0.8 }),
        c('description', 'Description', 'longtext', { width: 1.8 }),
        c('tempCue', 'Temp Cue Name', 'text', { width: 1.6 }),
        c('artist', 'Artist', 'combo', { prefill: 'artist', width: 1.2 }),
        c('cueName', 'Cue Name', 'text', { prefill: 'cueTitle', width: 1.6 }),
        c('cueSummary', 'Cue Summary', 'longtext', { width: 1.8 }),
        c('library', 'Cue Library Used', 'combo', { prefill: 'library', width: 1.2 }),
        c('link', 'Link', 'link', { width: 1.4 }),
        c('composerNotes', 'Composer Notes', 'longtext', { width: 1.8 }),
        c('directorNotes', 'Director Notes', 'longtext', { width: 1.8 }),
        c('approval', 'Approval', 'status', { options: APPROVAL, width: 1 }),
        c('logNote', 'Clip Log Note', 'auto', { auto: 'logNote', width: 1.4 }),
      ],
    },
    {
      key: 'archival',
      label: 'Archival',
      color: '#2fd18f',
      grouping: 'none',
      gapFrames: 0,
      extractArchivalIds: true,
      screenshotAt: 'mid',
      columns: [
        c('screenshot', 'Screenshot', 'auto', { auto: 'screenshot', width: 1.4 }),
        c('recIn', 'Timecode In', 'auto', { auto: 'recIn', width: 1.1 }),
        c('recOut', 'Timecode Out', 'auto', { auto: 'recOut', width: 1.1 }),
        c('srcIn', 'Source Start', 'auto', { auto: 'srcIn', width: 1.1 }),
        c('srcOut', 'Source End', 'auto', { auto: 'srcOut', width: 1.1 }),
        c('duration', 'Duration', 'auto', { auto: 'duration', width: 1 }),
        c('usage', 'Type', 'auto', { auto: 'usage', width: 0.8 }),
        c('sourceType', 'Source Type', 'auto', { auto: 'sourceType', width: 0.9 }),
        c('archivalId', 'Archival ID', 'auto', { auto: 'archivalId', width: 1.2 }),
        c('fileName', 'File Name', 'auto', { auto: 'fileName', width: 2.2 }),
        c('clipLink', 'Clip Link', 'link', { width: 1.4 }),
        c('evidence', 'Source Screenshot', 'images', { width: 1.4 }),
        c('folderLink', 'Folder Link', 'link', { width: 1.4 }),
        c('owner', 'Owner', 'combo', { width: 1.2 }),
        c('notes', 'Notes', 'longtext', { width: 2 }),
        c('masterReceived', 'Master Received', 'checkbox', { stampDate: true, width: 1 }),
      ],
    },
    subtitleCategory(),
  ];
}

/** Built-in tracker filled from an SRT rather than an XML/EDL. */
export function subtitleCategory(): CategoryConfig {
  return {
    key: 'subs',
    label: 'Subtitles',
    color: '#e6c15a',
    grouping: 'none',
    gapFrames: 0,
    extractArchivalIds: false,
    screenshotAt: 'in',
    source: 'srt',
    columns: [
      c('recIn', 'TC In', 'auto', { auto: 'recIn', width: 1.1 }),
      c('recOut', 'TC Out', 'auto', { auto: 'recOut', width: 1.1 }),
      c('duration', 'Duration', 'auto', { auto: 'duration', width: 0.9 }),
      c('subtitle', 'Subtitle', 'auto', { auto: 'subtitle', width: 2.6 }),
      c('notes', 'Notes', 'longtext', { width: 2 }),
    ],
  };
}

type CueSheetProject = {
  categories: CategoryConfig[];
  episodes: { versions: { items: { [key: string]: { values: Item['values']; auto: Item['auto'] }[] } }[] }[];
};

/**
 * The stock cue sheet used to show the parsed track title in Temp Cue Name.
 * Move that default onto Cue Name, and leave Temp Cue Name blank for a name
 * typed by hand. A project that already changed either column is left alone.
 * Returns whether this project changed.
 */
export function migrateMusicCueColumns(project: CueSheetProject): boolean {
  const keys: string[] = [];
  for (const cat of project.categories) {
    if (cat.grouping !== 'music') continue;
    const temp = cat.columns.find((col) => col.id === 'tempCue');
    const cue = cat.columns.find((col) => col.id === 'cueName');
    if (!temp || !cue) continue;
    if (temp.type !== 'auto' || temp.auto !== 'cueTitle') continue;
    if (cue.type !== 'text' || cue.prefill || cue.auto) continue;
    temp.type = 'text';
    delete temp.auto;
    cue.prefill = 'cueTitle';
    keys.push(cat.key);
  }
  if (!keys.length) return false;
  for (const episode of project.episodes) {
    for (const version of episode.versions) {
      for (const key of keys) {
        for (const item of version.items[key] ?? []) {
          const current = item.values.cueName;
          if ((current === undefined || current === '' || current === null) && item.auto.cueTitle) {
            item.values.cueName = item.auto.cueTitle;
          }
        }
      }
    }
  }
  return true;
}

/**
 * The stock Artist column only displayed the name parsed from the file.
 * Make that column editable, and copy a parsed name in when the cell is empty.
 * A project that already changed the column is left alone.
 */
export function migrateArtistColumn(project: CueSheetProject): boolean {
  const keys: string[] = [];
  for (const cat of project.categories) {
    if (cat.grouping !== 'music') continue;
    const artist = cat.columns.find((col) => col.id === 'artist');
    if (!artist || artist.type !== 'auto' || artist.auto !== 'artist' || artist.prefill) continue;
    artist.type = 'combo';
    artist.prefill = 'artist';
    delete artist.auto;
    keys.push(cat.key);
  }
  if (!keys.length) return false;
  for (const episode of project.episodes) {
    for (const version of episode.versions) {
      for (const key of keys) {
        for (const item of version.items[key] ?? []) {
          const current = item.values.artist;
          if ((current === undefined || current === '' || current === null) && item.auto.artist) {
            item.values.artist = item.auto.artist;
          }
        }
      }
    }
  }
  return true;
}

/** Add the subtitle tracker when a saved project doesn't have one yet. */
export function ensureSubtitles(categories: CategoryConfig[]): boolean {
  if (categories.some((c) => c.source === 'srt' || c.key === 'subs')) return false;
  categories.push(subtitleCategory());
  return true;
}

export function defaultSettings(): ProjectSettings {
  return {
    archivalPrefixes: [],
    sourceTypeLetters: { F: 'Footage', A: 'Audio', S: 'Still' },
    ignoreClips: [
      'Black Video',
      'Slug',
      'Color Matte',
      'Transparent Video',
      'Adjustment Layer',
      'Bars and Tone',
      'Universal Counting Leader',
    ],
    musicStripWords: [
      'STEMS', 'STEM', 'BASS', 'DRUMS', 'DRUM', 'INSTRUMENTS', 'INSTRUMENT', 'MELODY', 'VOCALS', 'VOCAL', 'VOX',
      'PERC', 'PERCUSSION', 'KEYS', 'GUITAR', 'GUITARS', 'STRINGS', 'SYNTH', 'SYNTHS', 'PADS', 'FX', 'INST',
      'INSTRUMENTAL', 'NOVOX', 'ALT', 'EDIT', 'MIX', 'MAIN', 'FULL', 'UNDERSCORE', 'CUTDOWN', 'LOOP', 'BED',
    ],
    libraryPrefixes: { 'ES_': 'Epidemic Sound', 'APM_': 'APM Music', 'MB_': 'Musicbed', 'AL_': 'Artlist' },
    defaultVideoStartTC: '00:59:55:00',
    pictureStartTC: '01:00:00:00',
    fallbackRate: { timebase: 24, ntsc: true },
    archivalRepeatMinSeconds: 1,
  };
}

/** Option → color for status pills. */
export function statusTone(value: string): 'good' | 'warn' | 'bad' | 'idle' {
  const v = value.toLowerCase();
  if (/(approved|final|cleared|done|complete|received|licensed)/.test(v)) return 'good';
  if (/(reject|replace|denied|blocked|issue|problem|remove)/.test(v)) return 'bad';
  if (/(review|pending|progress|waiting|requested|sent)/.test(v)) return 'warn';
  return 'idle';
}
