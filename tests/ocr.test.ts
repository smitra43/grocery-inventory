import { describe, expect, it } from 'vitest';
import { adaptiveThreshold, estimateSkew, findPaperBounds, mergeOverlapping } from '../src/lib/ocr';

describe('mergeOverlapping', () => {
  it('drops lines repeated where two photos overlap', () => {
    const merged = mergeOverlapping([
      ['MILK 3.49', 'EGGS 2.99', 'BREAD 2.50'],
      ['EGGS 2.99', 'BREAD 2.5O', 'APPLES 4.00'],
    ]);
    // "2.5O" vs "2.50" differ, so only an exact seam match is removed
    expect(merged).toEqual(['MILK 3.49', 'EGGS 2.99', 'BREAD 2.50', 'EGGS 2.99', 'BREAD 2.5O', 'APPLES 4.00']);
    expect(mergeOverlapping([['A 1.00', 'B 2.00'], ['b 2.00', 'C 3.00']])).toEqual(['A 1.00', 'B 2.00', 'C 3.00']);
  });

  it('keeps everything when photos do not overlap', () => {
    expect(mergeOverlapping([['A'], ['B']])).toEqual(['A', 'B']);
  });
});

describe('adaptiveThreshold', () => {
  it('keeps dark text dark under a strong lighting gradient', () => {
    const w = 64, h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // background brightens left to right (shadow on the left); a "text" column every 8px is 40% darker
        const bg = 90 + x * 2.5;
        const v = x % 8 === 4 ? bg * 0.6 : bg;
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    adaptiveThreshold(data, w, h);
    const at = (x: number) => data[(8 * w + x) * 4];
    expect(at(4)).toBe(0); // text in the shadow
    expect(at(60)).toBe(0); // text in the light
    expect(at(2)).toBe(255); // shadowed paper becomes white
    expect(at(58)).toBe(255);
  });
});

describe('estimateSkew', () => {
  function tiltedLines(deg: number) {
    const w = 400, h = 300;
    const dark = new Uint8Array(w * h);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let line = 40; line < 280; line += 30) {
      for (let x = 20; x < 380; x++) {
        if (x % 7 === 0) continue; // gaps between "letters"
        for (let k = 0; k < 4; k++) {
          const y = Math.round(line + k + x * t);
          if (y >= 0 && y < h) dark[y * w + x] = 1;
        }
      }
    }
    return { dark, w, h };
  }

  it('recovers the tilt of text lines', () => {
    for (const deg of [-4, -1.5, 0, 2.5, 3.5]) {
      const { dark, w, h } = tiltedLines(deg);
      expect(Math.abs(estimateSkew(dark, w, h) - deg)).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('findPaperBounds', () => {
  it('finds a bright receipt on a dark table, inset from its edge', () => {
    const w = 200, h = 300;
    const g = new Float64Array(w * h).fill(60);
    for (let y = 40; y < 260; y++) for (let x = 50; x < 150; x++) g[y * w + x] = y % 12 < 2 ? 40 : 230; // paper with text rows
    const box = findPaperBounds(g, w, h)!;
    expect(box.x).toBeGreaterThanOrEqual(50);
    expect(box.x).toBeLessThan(56);
    expect(box.x + box.w).toBeLessThanOrEqual(150);
    expect(box.y).toBeGreaterThanOrEqual(40);
    expect(box.y + box.h).toBeLessThanOrEqual(260);
    expect(box.h).toBeGreaterThan(190);
  });

  it('returns null when the paper already fills the photo', () => {
    const g = new Float64Array(100 * 100).fill(230);
    expect(findPaperBounds(g, 100, 100)).toBeNull();
  });
});
