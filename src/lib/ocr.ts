import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

/**
 * On-device receipt reading: clean up the photo on a canvas, then run Tesseract
 * (WASM) in a web worker. Nothing leaves the phone.
 */

const TARGET_WIDTH = 1600;

/**
 * Bradley–Roth adaptive threshold: each pixel is compared with the mean of its
 * neighbourhood, so uneven light, shadows and faded thermal print still binarize cleanly.
 * Operates in place on RGBA data. Exported for tests.
 */
export function adaptiveThreshold(data: Uint8ClampedArray, width: number, height: number, t = 0.15): void {
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  // Integral image with a zero row/column so window sums need no bounds checks.
  const w1 = width + 1;
  const integral = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      integral[(y + 1) * w1 + x + 1] = integral[y * w1 + x + 1] + row;
    }
  }
  const half = Math.max(8, Math.round(width / 32));
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(width, x + half + 1);
      const sum = integral[y1 * w1 + x1] - integral[y0 * w1 + x1] - integral[y1 * w1 + x0] + integral[y0 * w1 + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * width + x] < mean * (1 - t) ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
}

/**
 * Estimate text tilt in degrees from dark-pixel coordinates using the
 * projection-profile method: rotate the points by each candidate angle and
 * pick the angle whose row histogram is "peakiest" (text lines line up into
 * sharp rows). Exported for tests.
 */
export function estimateSkew(dark: Uint8Array, width: number, height: number, maxDeg = 8): number {
  const pts: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 60000))); // subsample big images
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) if (dark[y * width + x]) pts.push(x, y);
  }
  if (pts.length < 40) return 0;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a), cos = Math.cos(a);
    const bins = new Map<number, number>();
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.round((pts[i + 1] * cos - pts[i] * sin) / step);
      bins.set(r, (bins.get(r) ?? 0) + 1);
    }
    let s = 0;
    for (const c of bins.values()) s += c * c;
    return s;
  };
  let best = 0, bestScore = -1;
  for (let d = -maxDeg; d <= maxDeg; d += 0.5) {
    const sc = score(d);
    if (sc > bestScore) [best, bestScore] = [d, sc];
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) {
    const sc = score(d);
    if (sc > bestScore) [best, bestScore] = [d, sc];
  }
  return Math.round(best * 10) / 10;
}

/** Otsu's threshold for a list of 0–255 values. */
function otsu(values: ArrayLike<number>): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > bestVar) [best, bestVar] = [t, v];
  }
  return best;
}

/**
 * Find the receipt paper: the largest block of rows and columns that are mostly
 * brighter than the background. Returns an inset box, or null when the paper
 * already fills the frame or no clear paper is found. Exported for tests.
 */
export function findPaperBounds(gray: Float64Array, width: number, height: number) {
  // Otsu splits paper from table; then place the cut 30% of the way from the table's mean
  // to the paper's, so paper in shadow still counts as paper.
  const split = otsu(gray);
  let darkSum = 0, darkN = 0, lightSum = 0, lightN = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= split) (darkSum += gray[i]), darkN++;
    else (lightSum += gray[i]), lightN++;
  }
  const t = darkN && lightN ? darkSum / darkN + 0.3 * (lightSum / lightN - darkSum / darkN) : split;
  const bright = (i: number) => (gray[i] > t ? 1 : 0);
  const colFrac = new Float64Array(width), rowFrac = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = bright(y * width + x);
      colFrac[x] += b / height;
      rowFrac[y] += b / width;
    }
  }
  // Smooth first so dark text lines inside the paper don't split it into pieces.
  const smooth = (fr: Float64Array): Float64Array => {
    const r = Math.max(2, Math.round(fr.length * 0.03));
    const out = new Float64Array(fr.length);
    let acc = 0;
    for (let i = 0; i < fr.length + r; i++) {
      if (i < fr.length) acc += fr[i];
      if (i - 2 * r - 1 >= 0) acc -= fr[i - 2 * r - 1];
      const c = i - r;
      if (c >= 0 && c < fr.length) out[c] = acc / (Math.min(fr.length - 1, c + r) - Math.max(0, c - r) + 1);
    }
    return out;
  };
  const longestRun = (raw: Float64Array, min: number): [number, number] => {
    const fr = smooth(raw);
    let best: [number, number] = [0, -1], start = -1;
    for (let i = 0; i <= fr.length; i++) {
      if (i < fr.length && fr[i] >= min) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
        start = -1;
      }
    }
    return best;
  };
  // Columns first, then measure rows only inside those columns so a narrow receipt still counts as "mostly paper".
  const [x0, x1] = longestRun(colFrac, 0.3);
  if (x1 - x0 < width * 0.2) return null;
  const inner = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = x0; x <= x1; x++) c += bright(y * width + x);
    inner[y] = c / (x1 - x0 + 1);
  }
  const [y0, y1] = longestRun(inner, 0.6);
  if (y1 - y0 < height * 0.2) return null;
  const w = x1 - x0, h = y1 - y0;
  if (w > width * 0.95 && h > height * 0.95) return null;
  // Step inside the paper edge so its outline doesn't become a black line next to the text.
  const inset = Math.round(Math.min(w, h) * 0.01);
  return { x: x0 + inset, y: y0 + inset, w: w - 2 * inset, h: h - 2 * inset };
}

function grayOf(data: Uint8ClampedArray, n: number): Float64Array {
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}

function darkMask(data: Uint8ClampedArray, n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = data[i * 4] === 0 ? 1 : 0;
  return m;
}

async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // Scale toward ~1600px wide: phone photos shrink, small screenshots grow, so text lands near the size Tesseract reads best.
  const scale = TARGET_WIDTH / bmp.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);

  // Measure tilt on a binarized copy, then redraw the photo rotated straight.
  const probe = ctx.getImageData(0, 0, canvas.width, canvas.height);
  adaptiveThreshold(probe.data, canvas.width, canvas.height);
  const skew = estimateSkew(darkMask(probe.data, canvas.width * canvas.height), canvas.width, canvas.height);
  if (Math.abs(skew) >= 0.3) {
    // Fill the uncovered corners with the photo's darkest tone so they read as background, not paper.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-skew * Math.PI) / 180);
    ctx.drawImage(bmp, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
    ctx.restore();
  }
  bmp.close();

  // Crop to the paper, dropping table and background.
  const straight = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const box = findPaperBounds(grayOf(straight.data, canvas.width * canvas.height), canvas.width, canvas.height);
  let out = canvas;
  if (box) {
    out = document.createElement('canvas');
    // Keep ~1600px width after cropping so small text isn't shrunk.
    const k = Math.min(2, TARGET_WIDTH / box.w);
    out.width = Math.round(box.w * k);
    out.height = Math.round(box.h * k);
    const octx = out.getContext('2d', { willReadFrequently: true })!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  }
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  const img = octx.getImageData(0, 0, out.width, out.height);
  adaptiveThreshold(img.data, out.width, out.height);
  octx.putImageData(img, 0, 0);
  if (import.meta.env.DEV) (window as unknown as { __ocrCanvas: HTMLCanvasElement }).__ocrCanvas = out;
  return out;
}

let workerPromise: Promise<Worker> | null = null;
let onProgress: ((p: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = new URL('ocr/', document.baseURI).href;
    const model = import.meta.env.VITE_OCR_MODEL_FILE;
    const init = (async () => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        // Our wrapper can rename the model download for hosts that don't serve .gz files.
        workerPath: `${base}worker-shim.js${model ? `?model=${encodeURIComponent(model)}` : ''}`,
        workerBlobURL: false,
        corePath: base,
        langPath: base,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') onProgress?.(m.progress);
        },
      });
      await worker.setParameters({
        // Receipts are one block of lines; "single column" mode splits the price column off after a wide gap.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
    // Tesseract can fail to load without rejecting, so give up after a while instead of spinning forever.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("The text reader didn't load. Check your connection and try again.")), 90_000),
    );
    workerPromise = Promise.race([init, timeout]);
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/**
 * Joins text from overlapping photos of one receipt, dropping lines repeated at
 * the seam (the end of photo N matching the start of photo N+1). Exported for tests.
 */
export function mergeOverlapping(pages: string[][]): string[] {
  const key = (l: string) => l.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out: string[] = [];
  for (const page of pages) {
    let overlap = 0;
    for (let n = Math.min(out.length, page.length, 15); n > 0; n--) {
      const tail = out.slice(-n).map(key).join('|');
      const head = page.slice(0, n).map(key).join('|');
      if (tail && tail === head) {
        overlap = n;
        break;
      }
    }
    out.push(...page.slice(overlap));
  }
  return out;
}

/** OCR each photo in order and return the receipt's text lines. */
export async function readReceipt(files: File[], progress: (fraction: number, label: string) => void): Promise<string[]> {
  progress(0, 'Loading the text reader…');
  const worker = await getWorker();
  const pages: string[][] = [];
  for (let i = 0; i < files.length; i++) {
    const label = files.length > 1 ? `Reading photo ${i + 1} of ${files.length}…` : 'Reading receipt…';
    progress(i / files.length, label);
    onProgress = (p) => progress((i + p) / files.length, label);
    const canvas = await prepare(files[i]);
    const { data } = await worker.recognize(canvas);
    pages.push(data.text.split('\n').filter((l) => l.trim()));
  }
  onProgress = null;
  return mergeOverlapping(pages);
}

/** Group pdf.js text items into lines, top to bottom, left to right. */
function textItemsToLines(items: Array<{ str: string; transform: number[] }>): string[] {
  const rows: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(' '));
}

/**
 * Read a receipt PDF (e.g. from kroger.com → Purchases). Uses the PDF's own text when it
 * has some; "Print to PDF" copies often draw letters as shapes instead, so those pages are
 * rendered sharply and read with OCR, which is near-perfect on clean digital text.
 */
export async function readReceiptPdf(file: File, progress: (fraction: number, label: string) => void): Promise<string[]> {
  progress(0, 'Opening PDF…');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = await page.getTextContent();
    const withText = (text.items as Array<{ str?: string }>).filter((i) => i.str?.trim());
    if (withText.length >= 5) {
      lines.push(...textItemsToLines(text.items as Array<{ str: string; transform: number[] }>));
      continue;
    }
    const label = `Reading page ${n} of ${doc.numPages}…`;
    progress((n - 1) / doc.numPages, label);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const worker = await getWorker();
    onProgress = (p) => progress((n - 1 + p) / doc.numPages, label);
    const { data } = await worker.recognize(canvas);
    onProgress = null;
    lines.push(...data.text.split('\n').filter((l) => l.trim()));
  }
  return lines;
}
