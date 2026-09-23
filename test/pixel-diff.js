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

/**
 * Honest fidelity metric (ROADMAP 2.5 D). Compares two opaque RGBA renders of
 * size w×h and returns { fidelity, diff, content }:
 *  - AA-tolerant: both images are box-filtered to 1/`downsample` resolution,
 *    then a cell matches when the other render has a matching cell within
 *    `radius` cells (checked both ways, pixelmatch-style). Sub-pixel glyph
 *    placement and anti-aliasing shifts (≲ 2px) pass; real misplacements and
 *    color errors don't.
 *  - Content-weighted: only cells where EITHER render differs from the page
 *    background count, so empty area can't dilute errors. The background is
 *    the dominant color of `a` over the whole image.
 *  - `region` [x, y, w, h] (full-res px) scores one component.
 * SELF-CONTAINED on purpose: the preview injects this exact function into the
 * browser via its source text, so the scored and unit-tested code are one.
 */
export function contentFidelity(a, b, w, h, opts = {}) {
  const tolerance = opts.tolerance ?? 16;
  const k = opts.downsample ?? 2;
  const radius = opts.radius ?? 1;
  const [rx, ry, rw, rh] = opts.region || [0, 0, w, h];
  // Dominant color of `a` (quantized) = shared page background.
  const counts = new Map();
  let bgKey = 0;
  let best = -1;
  for (let i = 0; i < a.length; i += 4) {
    const key = ((a[i] >> 3) << 10) | ((a[i + 1] >> 3) << 5) | (a[i + 2] >> 3);
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    if (n > best) { best = n; bgKey = key; }
  }
  const bg = [((bgKey >> 10) & 31) * 8 + 4, ((bgKey >> 5) & 31) * 8 + 4, (bgKey & 31) * 8 + 4];
  const x1 = Math.max(0, Math.floor(rx));
  const y1 = Math.max(0, Math.floor(ry));
  const x2 = Math.min(w, Math.ceil(rx + rw));
  const y2 = Math.min(h, Math.ceil(ry + rh));
  const cw = Math.ceil((x2 - x1) / k);
  const ch = Math.ceil((y2 - y1) / k);
  const grid = (d) => {
    const g = new Float32Array(cw * ch * 3);
    for (let gy = 0; gy < ch; gy++) {
      for (let gx = 0; gx < cw; gx++) {
        let r = 0; let gg = 0; let bb = 0; let n = 0;
        for (let y = y1 + gy * k; y < Math.min(y1 + gy * k + k, y2); y++) {
          for (let x = x1 + gx * k; x < Math.min(x1 + gx * k + k, x2); x++) {
            const i = (y * w + x) * 4;
            const al = d[i + 3] / 255;
            r += d[i] * al; gg += d[i + 1] * al; bb += d[i + 2] * al;
            n++;
          }
        }
        const o = (gy * cw + gx) * 3;
        g[o] = r / n; g[o + 1] = gg / n; g[o + 2] = bb / n;
      }
    }
    return g;
  };
  const ga = grid(a);
  const gb = grid(b);
  const off = (g, o, q) => Math.abs(g[o] - q[0]) > tolerance || Math.abs(g[o + 1] - q[1]) > tolerance || Math.abs(g[o + 2] - q[2]) > tolerance;
  // Does cell (gx, gy) of `src` have a match anywhere within `radius` in `dst`?
  const found = (src, dst, gx, gy) => {
    const o = (gy * cw + gx) * 3;
    const q = [src[o], src[o + 1], src[o + 2]];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        if (!off(dst, (ny * cw + nx) * 3, q)) return true;
      }
    }
    return false;
  };
  let diff = 0;
  let content = 0;
  for (let gy = 0; gy < ch; gy++) {
    for (let gx = 0; gx < cw; gx++) {
      const o = (gy * cw + gx) * 3;
      if (!off(ga, o, bg) && !off(gb, o, bg)) continue;
      content++;
      if (!found(ga, gb, gx, gy) || !found(gb, ga, gx, gy)) diff++;
    }
  }
  return { fidelity: content ? 1 - diff / content : 1, diff, content };
}
