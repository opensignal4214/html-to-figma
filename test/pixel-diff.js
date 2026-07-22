// Pure pixel comparison for the fidelity score. Compares two RGBA buffers
// (Uint8ClampedArray/Uint8Array/Array, length = w*h*4) and reports the
// fraction of pixels that differ beyond a per-channel tolerance. Kept pure and
// dependency-free so it's unit-testable; the preview harness supplies the
// buffers by rasterizing the browser screenshot and the simulated render.

/**
 * @returns {{ diff: number, total: number, fraction: number, fidelity: number }}
 *   fraction = differing pixels / total; fidelity = 1 - fraction.
 * A pixel counts as different when any RGB channel differs by more than
 * `tolerance` (0–255). Alpha is folded in by compositing over the same
 * assumed-opaque background, so fully transparent vs opaque still registers.
 */
export function pixelDiff(a, b, tolerance = 16) {
  if (a.length !== b.length) throw new Error(`buffer length mismatch: ${a.length} vs ${b.length}`);
  const total = Math.floor(a.length / 4);
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255;
    const ba = b[i + 3] / 255;
    // Premultiply against a shared background so alpha differences count.
    let differs = false;
    for (let c = 0; c < 3; c++) {
      const av = a[i + c] * aa;
      const bv = b[i + c] * ba;
      if (Math.abs(av - bv) > tolerance) {
        differs = true;
        break;
      }
    }
    if (differs) diff++;
  }
  const fraction = total ? diff / total : 0;
  return { diff, total, fraction, fidelity: 1 - fraction };
}
