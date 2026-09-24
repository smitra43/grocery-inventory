export interface EncodedImage {
  mediaType: 'image/jpeg';
  /** base64, no data: prefix */
  data: string;
}

const MAX_WIDTH = 1000;
/** Tiles taller than this ratio get split, since the model downsizes very tall images and small print becomes unreadable. */
const MAX_RATIO = 1.8;
const OVERLAP = 0.15;

async function load(file: File): Promise<ImageBitmap> {
  // imageOrientation honors EXIF rotation from phone cameras.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function toJpeg(canvas: HTMLCanvasElement): EncodedImage {
  return { mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

/** Plan vertical slices [top, height] in scaled pixels, overlapping so no line is cut in half. */
export function planSlices(width: number, height: number): Array<[number, number]> {
  const sliceH = Math.round(width * MAX_RATIO);
  if (height <= sliceH) return [[0, height]];
  const step = Math.round(sliceH - width * OVERLAP);
  const slices: Array<[number, number]> = [];
  for (let top = 0; ; top += step) {
    if (top + sliceH >= height) {
      slices.push([Math.max(0, height - sliceH), Math.min(sliceH, height)]);
      break;
    }
    slices.push([top, sliceH]);
  }
  return slices;
}

/** Downscale each photo and split long receipts into overlapping slices. */
export async function prepareReceiptImages(files: File[]): Promise<EncodedImage[]> {
  const out: EncodedImage[] = [];
  for (const file of files) {
    const bmp = await load(file);
    const scale = Math.min(1, MAX_WIDTH / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    for (const [top, sliceH] of planSlices(w, h)) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = sliceH;
      canvas.getContext('2d')!.drawImage(bmp, 0, top / scale, bmp.width, sliceH / scale, 0, 0, w, sliceH);
      out.push(toJpeg(canvas));
    }
    bmp.close();
  }
  return out;
}
