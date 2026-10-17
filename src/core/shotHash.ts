/**
 * 8×8 average hash of a screenshot. Close hashes mean the same picture;
 * the bit math stays here so it can be tested without a canvas.
 */

export function averageHash(pixels: Uint8ClampedArray, width: number, height: number): string {
  const cols = 8;
  const rows = 8;
  const grays: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor((x * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / cols));
      const y0 = Math.floor((y * height) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / rows));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy += stepY) {
        for (let xx = x0; xx < x1; xx += stepX) {
          const i = (yy * width + xx) * 4;
          sum += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
          n++;
        }
      }
      grays.push(n ? sum / n : 0);
    }
  }
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  let bits = 0n;
  grays.forEach((g, i) => {
    if (g >= avg) bits |= 1n << BigInt(i);
  });
  return bits.toString(16).padStart(16, '0');
}

/** Hamming distance, or null when either hash isn't a 64-bit hex string. */
export function hashDistance(a: string, b: string): number | null {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return null;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
