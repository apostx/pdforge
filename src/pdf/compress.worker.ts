// Shrinks one image at a time off the main thread, so the page stays responsive on slow machines.
// Encoded images (JPEG, PNG…) are decoded straight at the target size with EXIF rotation applied,
// so a full-size photo never has to fit in memory. Raw pixel data from inside PDFs (FlateDecode,
// 8 bits per component) is unpacked here first.

export type CompressSource =
  | { kind: 'encoded'; blob: Blob }
  | {
      kind: 'raw';
      /** The stream as stored in the PDF: zlib-compressed rows. */
      data: Uint8Array;
      width: number;
      height: number;
      components: 1 | 3;
      /** /DecodeParms /Predictor: 1 none, 10–15 PNG row filters. */
      predictor: number;
    };

export interface CompressRequest {
  id: number;
  source: CompressSource;
  width: number;
  height: number;
  quality: number;
  /** Keep transparency (PNG out) if the image actually has some. */
  mayHaveAlpha: boolean;
}

export type CompressResponse = { id: number; blob: Blob } | { id: number; error: string };

// The project compiles against the DOM typings (the webworker ones clash with them), so
// describe just the part of the worker scope used here.
const scope = self as unknown as {
  onmessage: (event: MessageEvent<CompressRequest>) => void;
  postMessage: (message: CompressResponse) => void;
};

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undoes PNG row filters (predictors 10–15): each row starts with a filter-type byte. */
function unpredict(data: Uint8Array, rowLength: number, bytesPerPixel: number, rows: number): Uint8Array {
  const out = new Uint8Array(rowLength * rows);
  for (let row = 0; row < rows; row++) {
    const filter = data[row * (rowLength + 1)];
    const input = row * (rowLength + 1) + 1;
    const start = row * rowLength;
    for (let i = 0; i < rowLength; i++) {
      const raw = data[input + i];
      const left = i >= bytesPerPixel ? out[start + i - bytesPerPixel] : 0;
      const up = row > 0 ? out[start - rowLength + i] : 0;
      const upLeft = row > 0 && i >= bytesPerPixel ? out[start - rowLength + i - bytesPerPixel] : 0;
      let value: number;
      switch (filter) {
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const toLeft = Math.abs(estimate - left);
          const toUp = Math.abs(estimate - up);
          const toUpLeft = Math.abs(estimate - upLeft);
          value = raw + (toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft);
          break;
        }
        default:
          value = raw;
      }
      out[start + i] = value & 0xff;
    }
  }
  return out;
}

async function rawToImageData(source: Extract<CompressSource, { kind: 'raw' }>): Promise<ImageData> {
  const { width, height, components, predictor } = source;
  const rowLength = width * components;
  let pixels = await inflate(source.data);
  if (predictor >= 10) pixels = unpredict(pixels, rowLength, components, height);
  if (pixels.length < rowLength * height) throw new Error('Image data is shorter than its size says');

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, i = 0; p < width * height; p++, i += components) {
    const o = p * 4;
    if (components === 1) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[i];
    } else {
      rgba[o] = pixels[i];
      rgba[o + 1] = pixels[i + 1];
      rgba[o + 2] = pixels[i + 2];
    }
    rgba[o + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function hasTransparency(context: OffscreenCanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

scope.onmessage = async ({ data }: MessageEvent<CompressRequest>) => {
  const { id, source, width, height, quality, mayHaveAlpha } = data;
  try {
    const input = source.kind === 'encoded' ? source.blob : await rawToImageData(source);
    const bitmap = await createImageBitmap(input, {
      imageOrientation: 'from-image',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: mayHaveAlpha })!;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    if (mayHaveAlpha && hasTransparency(context, width, height)) {
      scope.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) });
      return;
    }
    scope.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }) });
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
