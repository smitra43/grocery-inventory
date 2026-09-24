// Copies the Tesseract worker, WASM engine and English model into public/ocr so the
// app serves them itself: no third-party CDN, and the service worker can cache them for offline use.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../public/ocr/', import.meta.url).pathname;
await mkdir(out, { recursive: true });

const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tess, 'dist/worker.min.js'), 'worker.min.js'],
  [new URL('./ocr-worker-shim.js', import.meta.url).pathname, 'worker-shim.js'],
  // LSTM-only engine builds; the worker picks one based on the device's WASM SIMD support.
  [join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // "best_int" model: more accurate than "fast", and only ~3 MB gzipped.
  [join(eng, '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, to] of files) await copyFile(from, join(out, to));
console.log(`OCR assets copied to ${out}`);
