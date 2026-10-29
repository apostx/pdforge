import type { SignatureData } from './store';

export type Point = { x: number; y: number };
export type Stroke = Point[];

export const INK_COLORS = { black: '#141414', blue: '#1b3f9c' } as const;
export type InkColor = keyof typeof INK_COLORS;

/** Draws strokes as smooth curves through the midpoints between samples. */
export function drawStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], color: string, lineWidth: number) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const points of strokes) {
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      context.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
    context.stroke();
  }
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders drawn strokes, cropped to the ink, at 3× for a crisp result in print. */
export async function strokesToSignature(strokes: Stroke[], color: string, lineWidth: number, name: string): Promise<SignatureData> {
  const SCALE = 3;
  const points = strokes.flat();
  const pad = lineWidth;
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const maxX = Math.max(...points.map((p) => p.x)) + pad;
  const maxY = Math.max(...points.map((p) => p.y)) + pad;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX) * SCALE);
  canvas.height = Math.ceil((maxY - minY) * SCALE);
  const context = canvas.getContext('2d')!;
  context.scale(SCALE, SCALE);
  context.translate(-minX, -minY);
  drawStrokes(context, strokes, color, lineWidth);
  return { name, png: await canvasToPng(canvas), width: canvas.width, height: canvas.height };
}

/** Longest side scans and photos are reduced to: enough for a sheet holding several signatures. */
const MAX_UPLOAD_SIDE = 2000;

/** Decodes an uploaded image (scaled down) once, so the clean-up can be re-run cheaply. */
export async function decodeUpload(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Turns paper into transparency. Brightness is judged against the paper's own brightness
 * (90th percentile), so grey-looking photos of white paper work too. `sensitivity` (0–1):
 * higher removes more of the light tones.
 */
export function cleanBackground(source: ImageData, sensitivity: number, ink: InkColor | 'original'): ImageData {
  const { width, height, data } = source;
  const luminance = new Float32Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luminance[p] = value;
    histogram[Math.min(255, Math.round(value))]++;
  }
  let paper = 255;
  for (let level = 255, seen = 0; level >= 0; level--) {
    seen += histogram[level];
    if (seen >= luminance.length * 0.1) {
      paper = Math.max(level, 1);
      break;
    }
  }

  const threshold = 0.55 + sensitivity * 0.4; // relative to paper brightness
  const softness = 0.25;
  const inkRgb = ink === 'original' ? null : hexToRgb(INK_COLORS[ink]);
  const out = new ImageData(width, height);
  for (let p = 0, i = 0; p < luminance.length; p++, i += 4) {
    const alpha = Math.max(0, Math.min(1, (threshold - luminance[p] / paper) / softness));
    if (alpha <= 0) continue;
    out.data[i] = inkRgb ? inkRgb[0] : data[i];
    out.data[i + 1] = inkRgb ? inkRgb[1] : data[i + 1];
    out.data[i + 2] = inkRgb ? inkRgb[2] : data[i + 2];
    out.data[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

/** Alpha above which a pixel counts as ink. */
const INK_ALPHA = 64;

/** Grows a grid of 0/1 cells by `rx` cells sideways and `ry` cells up and down. */
function dilate(cells: Uint8Array, width: number, height: number, rx: number, ry: number): Uint8Array {
  const across = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++) {
    let count = 0; // ink cells inside the sliding window [x - rx, x + rx]
    for (let x = 0; x < Math.min(rx, width); x++) count += cells[y * width + x];
    for (let x = 0; x < width; x++) {
      if (x + rx < width) count += cells[y * width + x + rx];
      if (x - rx - 1 >= 0) count -= cells[y * width + x - rx - 1];
      across[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(cells.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(ry, height); y++) count += across[y * width + x];
    for (let y = 0; y < height; y++) {
      if (y + ry < height) count += across[(y + ry) * width + x];
      if (y - ry - 1 >= 0) count -= across[(y - ry - 1) * width + x];
      out[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Finds the separate signatures on a cleaned image (a sheet may hold several) and crops each.
 * Ink is collected on a coarse grid and grown so that the strokes of one signature join up:
 * further sideways than up and down, because words of a name sit side by side while separate
 * signatures are usually stacked. `grouping` (0–1) sets how far apart strokes may be and still
 * count as one signature. Specks of dirt are dropped; results come in reading order.
 */
export function splitSignatures(clean: ImageData, grouping: number): HTMLCanvasElement[] {
  const { width, height, data } = clean;
  const cell = Math.max(2, Math.round(Math.max(width, height) / 400));
  const gridWidth = Math.ceil(width / cell);
  const gridHeight = Math.ceil(height / cell);

  const ink = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > INK_ALPHA) ink[((y / cell) | 0) * gridWidth + ((x / cell) | 0)] = 1;
    }
  }

  // from a few pixels (only touching strokes join) up to about 8% of the image
  const reach = Math.max(1, Math.round((0.003 + grouping * 0.08) * (Math.max(width, height) / cell)));
  const grown = dilate(ink, gridWidth, gridHeight, reach, Math.max(1, Math.round(reach / 2)));

  // label the joined-up areas (flood fill with an explicit stack)
  const labels = new Int32Array(grown.length).fill(-1);
  const stack = new Int32Array(grown.length);
  let count = 0;
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || labels[start] >= 0) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const index = stack[--top];
      const x = index % gridWidth;
      const neighbours = [x > 0 ? index - 1 : -1, x < gridWidth - 1 ? index + 1 : -1, index - gridWidth, index + gridWidth];
      for (const next of neighbours) {
        if (next < 0 || next >= grown.length || !grown[next] || labels[next] >= 0) continue;
        labels[next] = count;
        stack[top++] = next;
      }
    }
    count++;
  }

  // exact pixel bounds and amount of ink per area
  const boxes = Array.from({ length: count }, () => ({ minX: width, minY: height, maxX: -1, maxY: -1, ink: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= INK_ALPHA) continue;
      const box = boxes[labels[((y / cell) | 0) * gridWidth + ((x / cell) | 0)]];
      box.ink++;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  const most = Math.max(0, ...boxes.map((box) => box.ink));
  const kept = boxes.filter((box) => box.ink >= Math.max(30, most * 0.05));

  // reading order: rows top to bottom (a row is anything starting within half a typical height), then left to right
  const typicalHeight = kept.map((box) => box.maxY - box.minY).sort((a, b) => a - b)[kept.length >> 1] ?? 0;
  kept.sort((a, b) => (Math.abs(a.minY - b.minY) > typicalHeight / 2 ? a.minY - b.minY : a.minX - b.minX));

  const pad = 4;
  return kept.map((box) => {
    const left = Math.max(0, box.minX - pad);
    const top = Math.max(0, box.minY - pad);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width - 1, box.maxX + pad) - left + 1;
    canvas.height = Math.min(height - 1, box.maxY + pad) - top + 1;
    canvas.getContext('2d')!.putImageData(clean, -left, -top, left, top, canvas.width, canvas.height);
    return canvas;
  });
}

export async function canvasToSignature(canvas: HTMLCanvasElement, name: string): Promise<SignatureData> {
  return { name, png: await canvasToPng(canvas), width: canvas.width, height: canvas.height };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
