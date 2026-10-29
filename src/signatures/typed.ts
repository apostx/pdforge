import caveatUrl from '@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf?url';
import dancingUrl from '@expo-google-fonts/dancing-script/400Regular/DancingScript_400Regular.ttf?url';
import sacramentoUrl from '@expo-google-fonts/sacramento/400Regular/Sacramento_400Regular.ttf?url';
import { canvasToSignature } from './imaging';
import type { SignatureData } from './store';

// Typed signatures are drawn into a PNG like any other signature, so these fonts never
// have to be embedded in a PDF (and pdf-lib's font subsetting never touches them).

export const SCRIPT_FONTS = {
  dancing: { family: 'PDForge Dancing Script', url: dancingUrl },
  sacramento: { family: 'PDForge Sacramento', url: sacramentoUrl },
  caveat: { family: 'PDForge Caveat', url: caveatUrl },
} as const;

export type ScriptFont = keyof typeof SCRIPT_FONTS;

const loading = new Map<ScriptFont, Promise<void>>();

export function loadScriptFont(font: ScriptFont): Promise<void> {
  let promise = loading.get(font);
  if (!promise) {
    const { family, url } = SCRIPT_FONTS[font];
    promise = new FontFace(family, `url(${url})`).load().then((face) => void document.fonts.add(face));
    promise.catch(() => loading.delete(font));
    loading.set(font, promise);
  }
  return promise;
}

/** Large enough to stay crisp when a signature is printed several centimetres wide. */
const SIZE = 120;

export async function typedSignature(text: string, font: ScriptFont, color: string, name: string): Promise<SignatureData> {
  await loadScriptFont(font);
  const css = `${SIZE}px "${SCRIPT_FONTS[font].family}"`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = css;
  const metrics = measure.measureText(text);
  // script fonts swash well beyond their advance width, so size the canvas by the ink
  const pad = SIZE * 0.15;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + 2 * pad);
  canvas.height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 2 * pad);
  const context = canvas.getContext('2d')!;
  context.font = css;
  context.fillStyle = color;
  context.fillText(text, pad + metrics.actualBoundingBoxLeft, pad + metrics.actualBoundingBoxAscent);
  return canvasToSignature(canvas, name);
}
