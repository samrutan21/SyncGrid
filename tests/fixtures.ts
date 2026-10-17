import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath wants a string here: under jsdom, `new URL()` is not Node's URL and Node 24 rejects it.
const DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/sample-data') + '/';

/** Read a sample file (kept in public/sample-data so the app can demo it too). */
export function fixture(name: string): string {
  return readFileSync(DIR + name, 'utf8');
}

export const V3 = 'OSOS_LP_S1_EP7_v3_261012_ProRes_Color_Ref__';
export const V4 = 'OSOS_LP_S1_EP7_v4_261014_ProRes_Color_Ref__';
