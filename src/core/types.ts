import type { Rate } from './timecode';

/* ------------------------------------------------------------------ */
/* Parsed timeline data (XML / EDL)                                    */
/* ------------------------------------------------------------------ */

export type MediaKind = 'video' | 'audio';

/** One clip/event on the timeline, as read from an XML or EDL. */
export interface TimelineEvent {
  origin: 'xml' | 'edl' | 'both';
  kind: MediaKind;
  name: string;
  /** Absolute record frames at the sequence timebase (e.g. 01:00:04:20 → frames). */
  recIn: number;
  recOut: number;
  /** Source timecode strings at the source's own rate. */
  srcIn?: string;
  srcOut?: string;
  /** Source position in source frames (when known) and the source timebase. */
  srcInFrames?: number;
  srcOutFrames?: number;
  srcTimebase?: number;
  /** Track or channel labels (V2, A1, A3 ...). */
  tracks: string[];
  reel?: string;
  filePath?: string;
  width?: number;
  height?: number;
  logNote?: string;
  description?: string;
  eventNumbers?: string[];
  isGenerator?: boolean;
  /** Problems found while reading/merging this event. */
  flags?: string[];
}

export interface TrackInfo {
  label: string; // V1, A3 ...
  kind: MediaKind;
  clipCount: number;
}

export interface ParsedTimeline {
  format: 'xml' | 'edl';
  sequenceName: string;
  rate: Rate;
  /** Sequence start in frames (e.g. 00:59:52:00). Null for EDLs. */
  startFrame: number | null;
  events: TimelineEvent[];
  tracks: TrackInfo[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Category + column configuration                                     */
/* ------------------------------------------------------------------ */

export type ColumnType =
  | 'auto' // read-only, computed from the timeline
  | 'text'
  | 'longtext'
  | 'link'
  | 'select' // fixed list of options
  | 'status' // select with colored states
  | 'combo' // free text that remembers previous entries
  | 'checkbox' // optional date stamp
  | 'date'
  | 'images'; // drag/paste/browse images or PDFs

export type AutoField =
  | 'screenshot'
  | 'recIn'
  | 'recOut'
  | 'duration'
  | 'durationMinSec'
  | 'clipName'
  | 'cueTitle'
  | 'artist'
  | 'library'
  | 'logNote'
  | 'srcIn'
  | 'srcOut'
  | 'reel'
  | 'resolution'
  | 'archivalId'
  | 'sourceType'
  | 'usage'
  | 'fileName'
  | 'filePath'
  | 'tracks'
  | 'segments'
  | 'subtitle';

export interface ColumnDef {
  id: string;
  label: string;
  type: ColumnType;
  /** For type 'auto'. */
  auto?: AutoField;
  /** For type 'select' / 'status'. */
  options?: string[];
  /** Pre-fill an editable column from an auto field when it is empty. */
  prefill?: AutoField;
  /** For checkboxes: record the date when checked. */
  stampDate?: boolean;
  hidden?: boolean;
  /** Relative width weight for tables / PDF. */
  width?: number;
}

export type GroupingMode = 'adjacent' | 'music' | 'none';

export interface CategoryConfig {
  key: string;
  label: string;
  color: string;
  /**
   * adjacent: copies/extensions of the same clip that touch are one entry (GFX)
   * music: stems/versions/edits of one cue are one entry (cue sheets)
   * none: every cut is its own row (archival)
   */
  grouping: GroupingMode;
  /** Frames: pieces closer than this merge; further apart become separate uses. */
  gapFrames: number;
  /** Extract Archival IDs + source type from clip names. */
  extractArchivalIds: boolean;
  /** Where to grab the auto screenshot inside the item. */
  screenshotAt: 'in' | 'mid';
  /** srt: this tracker is filled from a subtitle file. Absent means XML/EDL. */
  source?: 'srt';
  columns: ColumnDef[];
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export interface Segment {
  name: string;
  recIn: number;
  recOut: number;
  srcIn?: string;
  srcOut?: string;
  tracks: string[];
}

export type CellValue = string | boolean | null | ImageRef[] | CheckValue;

export interface CheckValue {
  checked: boolean;
  date?: string; // ISO date
}

export interface ImageRef {
  /** Key into blob storage. */
  key: string;
  name: string;
  type: string;
}

export interface Item {
  id: string;
  kind: MediaKind;
  /** Display name: first clip name. */
  name: string;
  /** Normalized identity used for grouping, repeat detection and version matching. */
  groupKey: string;
  recIn: number;
  recOut: number;
  srcIn?: string;
  srcOut?: string;
  srcInFrames?: number;
  srcOutFrames?: number;
  srcTimebase?: number;
  reel?: string;
  tracks: string[];
  segments: Segment[];
  auto: Partial<Record<AutoField, string>>;
  flags: string[];
  values: Record<string, CellValue>;
  /** Screenshot frame the user picked. Absent means the automatic frame. */
  shotFrame?: number;
  /** Frame stored in the screenshot file, so a grab isn't repeated. */
  capturedFrame?: number;
  /** Average hash of that screenshot, so a later version can recognize the picture. */
  shotHash?: string;
  /** Picture match already considered, so clearing a note does not write it back. */
  shotCompared?: boolean;
  /** Added by hand. Kept when the XML/EDL is imported again. */
  manual?: boolean;
  /** Frames added on top of the imported in and out. */
  shift?: { in: number; out: number };
}

/* ------------------------------------------------------------------ */
/* Project structure                                                    */
/* ------------------------------------------------------------------ */

export interface SlotFile {
  fileName: string;
  importedAt: string;
  /** Raw text kept so the version can be re-processed when settings change. */
  text: string;
}

export interface CategorySlot {
  xml?: SlotFile;
  edl?: SlotFile;
  /** Subtitle file, for a category whose source is 'srt'. */
  srt?: SlotFile;
  /**
   * Sequence timecode where 00:00:00 in the subtitle file falls.
   * 00:00:00:00 means the file is already in sequence timecode.
   */
  srtZero?: string;
  /** Track labels to include (XML only). Empty/undefined = all tracks. */
  trackFilter?: string[];
  warnings: string[];
  stats?: { xmlEvents: number; edlEvents: number; matched: number; items: number };
}

export interface VideoSlot {
  fileName: string;
  /** Start timecode of the video file, e.g. 00:59:55:00. Editable. */
  startTC: string;
  /** Whether a FileSystemFileHandle is stored for this version. */
  hasHandle?: boolean;
  /** Timecode read from the file when it was chosen, so a manual edit can be restored. */
  detectedStartTC?: string;
  /** file = a timecode track in the container. picture = burned-in timecode. */
  detectedFrom?: 'file' | 'picture';
}

export interface Version {
  id: string;
  label: string;
  createdAt: string;
  rate: Rate;
  /** Sequence start frame from the XML (informational). */
  seqStartFrame: number | null;
  video?: VideoSlot;
  slots: Record<string, CategorySlot>;
  items: Record<string, Item[]>;
  /** Version used as the baseline when this version was imported. */
  carriedFrom?: string;
  /** Imported cuts removed by hand. A later import won't bring an overlapping one back. */
  dismissed?: Record<string, { groupKey: string; recIn: number; recOut: number }[]>;
}

export interface Episode {
  id: string;
  name: string;
  versions: Version[];
}

export interface ProjectSettings {
  /** Archival ID prefixes, e.g. ["OSOS"]. */
  archivalPrefixes: string[];
  /** Archival ID type letters → label. */
  sourceTypeLetters: Record<string, string>;
  /** Clip names to ignore (slugs, black video ...). Case-insensitive substrings. */
  ignoreClips: string[];
  /** Words stripped from music clip names before grouping. */
  musicStripWords: string[];
  /** Filename prefix → library name. */
  libraryPrefixes: Record<string, string>;
  /** Default start TC for new video files. */
  defaultVideoStartTC: string;
  /** Picture start (first frame of action). */
  pictureStartTC: string;
  /** Fallback rate for EDL-only imports. */
  fallbackRate: Rate;
  /** Minimum source overlap (seconds) for an archival repeat. */
  archivalRepeatMinSeconds: number;
  /** Subtitle proofreading pass. Absent or "off" runs nothing. */
  subtitleRules?: string;
  /** GFX category set. Absent or "off" is one tracker. */
  gfxCategories?: string;
  /** Types for the active GFX set, in tab and export order. */
  gfxTypes?: { id: string; label: string; short: string }[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  categories: CategoryConfig[];
  episodes: Episode[];
  schemaVersion: 1;
}

export interface ColumnTemplate {
  id: string;
  name: string;
  categories: CategoryConfig[];
  createdAt: string;
}
