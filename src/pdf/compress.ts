import type { CompressRequest, CompressResponse, CompressSource } from './compress.worker';

export type { CompressSource };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<CompressResponse>) => {
      const request = pending.get(data.id);
      pending.delete(data.id);
      if ('error' in data) request?.reject(new Error(data.error));
      else request?.resolve(data.blob);
    };
  }
  return worker;
}

/** Decodes the image at width×height (upright) and re-encodes it as JPEG, or PNG if it has transparency. */
export function compressImage(source: CompressSource, width: number, height: number, quality: number, mayHaveAlpha: boolean): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, source, width, height, quality, mayHaveAlpha } satisfies CompressRequest);
  });
}

/** Ends the worker, giving its memory back. */
export function releaseCompressor(): void {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(new Error('Compressor released'));
  pending.clear();
}
