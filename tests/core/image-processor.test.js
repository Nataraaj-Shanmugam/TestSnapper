import { describe, it, expect } from 'vitest';
import { ImageProcessor } from '../../src/core/image-processor.js';

/**
 * Build a stub canvas 2D context whose getImageData returns a crafted
 * pixel field. No real canvas is needed — detectContentType only reads
 * .data/.width/.height off the returned ImageData-like object.
 *
 * @param {number} w
 * @param {number} h
 * @param {(x:number, y:number) => number} lumFn - returns 0..255 grey value
 */
function makeCtx(w, h, lumFn) {
  return {
    getImageData(_sx, _sy, sw, sh) {
      const width = sw;
      const height = sh;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const v = lumFn(x, y);
          data[idx] = v;       // R
          data[idx + 1] = v;   // G
          data[idx + 2] = v;   // B
          data[idx + 3] = 255; // A
        }
      }
      return { data, width, height };
    }
  };
}

describe('ImageProcessor.detectContentType', () => {
  it("returns 'png' for high edge density (alternating black/white)", () => {
    // Checkerboard at 1px resolution → almost every neighbour transition is
    // a sharp edge → very high edge density → text/UI → PNG.
    const ctx = makeCtx(50, 50, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    expect(ImageProcessor.detectContentType(ctx, 50, 50)).toBe('png');
  });

  it("returns 'jpeg' for a flat / low-edge field", () => {
    // Uniform mid-grey → no luminance transitions → edge density 0 → photo → JPEG.
    const ctx = makeCtx(50, 50, () => 128);
    expect(ImageProcessor.detectContentType(ctx, 50, 50)).toBe('jpeg');
  });

  it("returns 'jpeg' for a smooth gradient (below the 0.12 edge threshold)", () => {
    // Gentle horizontal gradient: per-pixel delta ~5 (< threshold 30) → no edges.
    const ctx = makeCtx(50, 50, (x) => Math.min(255, x * 5));
    expect(ImageProcessor.detectContentType(ctx, 50, 50)).toBe('jpeg');
  });

  it("falls back to 'jpeg' when getImageData throws", () => {
    const ctx = { getImageData() { throw new Error('no canvas'); } };
    expect(ImageProcessor.detectContentType(ctx, 10, 10)).toBe('jpeg');
  });
});
