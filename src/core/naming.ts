/**
 * Clip-name helpers: archival IDs, music cue normalization, library + artist
 * detection. Everything here is driven by project settings, nothing is
 * hard-wired to one show.
 */

export interface ArchivalIdMatch {
  id: string;
  prefix: string;
  letter: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find an Archive Ox style ID such as OSOS-F0067 in a clip name.
 * Prefixes come from settings ("OSOS"); letters from the type map (F/A/S).
 */
export function extractArchivalId(
  name: string,
  prefixes: string[],
  letters: string[],
): ArchivalIdMatch | undefined {
  const clean = prefixes.map((p) => p.trim()).filter(Boolean);
  if (!clean.length) return undefined;
  const letterClass = letters.length ? `[${letters.map(esc).join('')}]` : '[A-Z]';
  const re = new RegExp(`(?:^|[^A-Za-z0-9])(${clean.map(esc).join('|')})[-_ ]?(${letterClass})(\\d{2,})`, 'i');
  const m = re.exec(name);
  if (!m) return undefined;
  const prefix = clean.find((p) => p.toLowerCase() === m[1].toLowerCase()) ?? m[1];
  const letter = m[2].toUpperCase();
  return { id: `${prefix}-${letter}${m[3]}`, prefix, letter };
}

export const stripExtension = (name: string) => name.replace(/\.(wav|aiff?|mp3|m4a|aac|flac|ogg|mov|mp4|mxf|png|jpe?g|tiff?|psd|ai|exr|dpx)$/i, '');

/**
 * Normalize a music clip name to its cue identity:
 *   "ES_Bad Guy (Instrumental Version) STEMS DRUMS - Nyck Caution.wav"
 *   → title "Bad Guy", artist "Nyck Caution", key "bad guy|nyck caution"
 */
export function normalizeCue(
  rawName: string,
  stripWords: string[],
  libraryPrefixes: Record<string, string>,
): { key: string; title: string; artist?: string; library?: string } {
  let name = stripExtension(rawName.trim());
  let library: string | undefined;
  for (const [prefix, lib] of Object.entries(libraryPrefixes)) {
    if (prefix && name.toLowerCase().startsWith(prefix.toLowerCase())) {
      library = lib;
      name = name.slice(prefix.length);
      break;
    }
  }
  // "Title STEMS DRUMS - Artist" / "Title - Artist"
  let artist: string | undefined;
  const dash = name.lastIndexOf(' - ');
  let title = name;
  if (dash > 0) {
    artist = name.slice(dash + 3).trim();
    title = name.slice(0, dash);
  }
  // Remove parenthetical / bracketed version tags.
  title = title.replace(/[([][^)\]]*(instrumental|inst|stem|version|edit|mix|alt|clean|main|underscore|no\s*vox|vocal|cut|loop)[^)\]]*[)\]]/gi, ' ');
  // Remove stem / version words from the END of the title only, so a title
  // like "Drums of War" keeps its words while "Bad Guy STEMS DRUMS" → "Bad Guy".
  const words = new Set(stripWords.map((w) => w.trim().toLowerCase()).filter(Boolean));
  const tokens = title.split(/[\s_]+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/^-+|-+$/g, '');
    if (words.has(last) || /^v?\d{1,3}$/.test(last) || last === '-') tokens.pop();
    else break;
  }
  title = tokens.join(' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!title) title = stripExtension(rawName);
  const key = `${title.toLowerCase()}|${(artist ?? '').toLowerCase()}`;
  return { key, title, artist, library };
}

/** Last path component, or the clip name. */
export function fileNameOf(name: string, path?: string): string {
  if (path) {
    const parts = path.split(/[\\/]/);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return name;
}
