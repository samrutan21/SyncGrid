# Cutsheet

A timeline-aware tracker for **GFX, music cue sheets and archival clearances**, built from your NLE's XML/EDL exports. Watch the cut with every graphic, cue and archival clip marked on the playbar, take notes per item, compare versions, and export the trackers as CSV or PDF.

Everything runs in your browser on your machine: no server, no uploads, no accounts.

---

## Setup (first time, ~2 minutes)

You need **Node.js 18.18 or newer**. In Cursor, open the terminal (`` Ctrl+` ``) and check:

```bash
node -v
```

If that prints nothing or an old version, install the LTS from https://nodejs.org, then reopen Cursor.

Then, from this folder:

```bash
npm install     # once
npm run dev     # every time you want to use it
```

Your browser opens at **http://localhost:5173** (if it isn't Chrome, copy that address into Chrome). Leave the terminal running while you work; `Ctrl+C` stops it.

> Use **Chrome** (or Edge). Chrome remembers your video files between sessions so switching versions is instant. Other browsers work but ask you to re-pick the video each session.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the parser/grouping/change-tracking tests against the sample episode |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` (static files, host anywhere) |
| `npm run build:demo` | The public GitHub Pages build. `npm run dev` does not use this |
| `npm run preview` | Serves the production build locally |

### Public demo

The site at `https://samrutan21.github.io/SyncGrid/` is built from this same code on every push to `main`. It only loads what is in `public/demo/`. Local episode files, including `public/sample-data`, are ignored and are not part of that build.

To put the royalty-free documentary on the demo, add its picture and interchange files to `public/demo/` and name them in `public/demo/manifest.json`:

```json
{
  "revision": 1,
  "project": "Demo",
  "episode": "Episode 1",
  "video": "picture.mp4",
  "startTC": "01:00:00:00",
  "versions": [
    {
      "label": "Version 1",
      "slots": {
        "gfx": { "xml": "gfx.xml", "edl": "gfx.edl" },
        "music": { "xml": "cue.xml", "edl": "cue.edl" },
        "archival": { "xml": "archival.xml", "edl": "archival.edl" },
        "subs": { "srt": "subtitles.srt" }
      }
    }
  ]
}
```

Leave out any file you don't have. `startTC` is the first frame of the video file. Raise `revision` when you replace those files so the site rebuilds the demo project. Use an H.264 MP4. GitHub accepts the file under 100 MB and warns above 50 MB.

---

## Using it

1. **New project** → name it (one project per show/client).
2. **New episode** → a version is created and the **Files** window opens.
3. Fill the slots. Nothing needs renaming — the slot decides what a file is:
   - **Video**: the H.264 MP4 offline (optional, needed for screenshots). **File starts at** is filled in from the file’s timecode track, or from a burned-in timecode when the picture has one. Edit it if the markers don’t match the picture. When neither is found, the fallback is `00:59:55:00` (QT refs from this show often use `00:59:52:00`).
   - **GFX / Cue Sheet / Archival**: an **XML**, an **EDL**, or **both** (recommended — they're merged on record timecode; XML supplies names/paths/resolution, EDL supplies source TC and reels; anything that doesn't line up is flagged).
   - **Subtitles**: an **SRT**. Each cue becomes a row you can note. A file timed from 00:00:00 lands on picture start; one already in sequence timecode is left as-is. On 23.976 the cue times are real time, so they sit on the picture rather than a few seconds late. **00:00:00 in the file is** moves the whole file if the cues don't match the picture.
   - Or drop everything on the big drop zone and it routes by file name.
   - **Archival ID prefix**: type `OSOS` (or your archive's prefix) and IDs like `OSOS-F04454` are pulled into their own column; F/A/S become Footage/Audio/Still.
4. **Review**: the playbar shows one lane per tracker. Click any marker or row to jump there; the sidebar opens that item's fields. Toggle GFX / Cue Sheet / Archival in the top bar to show one, two or all three.
5. **New version** (Version menu → *New version…*): drop that cut's files. Notes, links, statuses and evidence carry forward to items with the same name. Placeholder names such as Graphic are left blank unless the screenshot matches one from the previous version. Each item is tagged **New**, **Changed** (duration/source changed) or **Shifted** (moved by a ripple, content unchanged). Removed items are listed at the bottom of each panel. Pick any version to compare against in the *vs* menu.
6. **Sheet** view = spreadsheet of one tracker, editable in place. The Text column stacks lines — Enter adds a line, and the A button sets that line large, normal, or small — so a title can follow the graphic.
7. **Export**: PDF (screenshots embedded), CSV, or CSV + images (zip). Optionally include the change report vs any version.

### Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Back / forward one frame |
| ⇧ ← / ⇧ → | One second |
| ↑ / ↓ | Previous / next marker |

### Rules it applies

- **GFX** — copies/extensions of the same graphic that touch (within *gap* frames, default 6) are one entry. A graphic that returns later is a new entry, flagged **Used 2×**.
- **Cue Sheet** — stems (`STEMS BASS/DRUMS/…`), instrumental/alt versions, file extensions and music edits collapse into one cue (gap default 12 frames). Library is detected from the prefix (`ES_` → Epidemic Sound), artist from `Title - Artist`, ISRC/notes from the clip's log note. A cue that comes back later is a separate use, flagged as a repeat.
- **Archival** — never grouped: every cut is its own row, video and audio separate. The only merge is identical stacked audio (e.g. two mono tracks of the same clip, same in/out). Type is from the timeline (Video/Audio/Still); Source Type is from the ID letter. A repeat = the same source moment (≥1 s overlap) used twice.
- **Subtitles** — one row per SRT cue, on the same playbar and in the same exports. Notes carry to the next version when the cue text matches.
- Black video, slugs, mattes, adjustment layers and bars/tone are ignored.

All of these are editable in **Settings** (gear icon): ID prefixes and letters, ignore list, stem words, library prefixes, gap per category, screenshot frame, plus adding/removing whole categories (VFX, subtitles, licensing …).

### Columns

Every category's columns are editable from the panel's columns icon (or **Columns** in Sheet view): add, rename, reorder, hide, delete, change type (text, long text, link, status, dropdown, text-that-remembers-entries, checkbox with date stamp, date, images/PDFs, or an auto field from the timeline). Save a setup as a **template** in Settings and pick it when creating a new project.

### Evidence (Source Screenshot)

Drop, paste (⌘V after a screenshot) or browse images/PDFs — releases, emails, licenses. Several per item. Stored locally; embedded in PDF exports and included as files in the CSV + images zip.

### Backup / sharing

Data lives in Chrome's storage for `localhost:5173` on this computer. **Export → Download backup** saves the whole project (notes, evidence, optionally screenshots) as a `.cutsheet.zip`; **Import backup** on the home screen restores it on any machine. Video files are never included — each person points to their own copy.

Clearing Chrome's site data for localhost deletes projects, so keep backups of anything important.

---

## Video notes

- Use **H.264 MP4** offlines. Chrome cannot decode ProRes or DNx — transcode in Media Encoder (H.264, match frame rate).
- Burned-in timecode makes it easy to confirm sync: jump to any marker and the burn-in should match the tracker. If it's off, fix **File starts at** for that version.
- 01:00:00:00 (picture start) is marked on the playbar; change it in Settings.

---

## Project structure

```
src/
  core/                 Pure logic, no UI, fully unit-tested
    timecode.ts         Frames ↔ TC (NDF/DF, 23.976 → 59.94)
    parsers/xmeml.ts    Premiere / FCP7 XML (transition cut points, exploded stereo tracks)
    parsers/edl.ts      CMX3600 EDL (V/A/A2/AA/B, NONE + AUD channels, dissolves)
    parsers/srt.ts      SRT / WebVTT cues → subtitle rows
    merge.ts            XML + EDL pairing, stacked-channel collapse
    naming.ts           Archival IDs, cue-name normalization
    pipeline.ts         Events → items (filter, group, metadata), repeat detection
    diff.ts             Version matching, change report, carry-forward
    importer.ts         Slot → items; auto-field values
    config/defaults.ts  Default categories, columns, settings
  storage/store.ts      Storage interface + IndexedDB implementation
  state/                App state + actions (tiny external store, no framework)
  media/screenshots.ts  Frame capture from the local video
  export/               CSV, PDF (pdf-lib), zip + project backup (jszip)
  ui/                   React components (player, playbar, panels, sheet, modals)
public/sample-data/     Local demo episode, not committed. Delete this folder to
                        remove the "Load sample project" button.
tests/                  Vitest tests. Episode fixtures stay in public/sample-data.
```

### Extending

- **Shared team data**: implement the `Store` interface in `src/storage/store.ts` against Supabase/Firebase/your API and swap the exported `store`. Nothing in the UI talks to IndexedDB directly.
- **New auto fields**: add to `AutoField` in `core/types.ts`, fill it in `core/pipeline.ts`, label it in `ui/modals/ColumnEditor.tsx`.
- **Other NLE formats** (FCPXML, AAF via a converter, OTIO): add a parser that returns a `ParsedTimeline`; everything downstream stays the same.

### Security

- No network calls at runtime; a Content-Security-Policy in `index.html` blocks external scripts, fonts and connections.
- XML is parsed with the browser's DOMParser with the DOCTYPE stripped (no external entities). All clip names and notes are rendered as text, never HTML.
- Links only open `http(s)`/`mailto`, with `noopener`. CSV exports neutralize spreadsheet formula injection.
- Attachments are limited to images/PDFs (40 MB each); timeline files to 80 MB.
