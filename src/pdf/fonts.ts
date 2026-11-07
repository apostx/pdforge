import type { Font } from '@pdf-lib/fontkit';
import { FONT_FAMILIES, type FontFamily } from './fontCatalog';
import { fontFeatures, padSubsetGlyphs } from './fontkitFixes';

// The standard PDF fonts can't encode ő/ű, so text is set in embedded fonts.
// The same font file is used on screen (via FontFace) and in the PDF, and all
// measuring goes through fontkit, so the editor shows exactly what gets exported.
//
// Fonts are subset when embedded. pdf-lib's subsetter garbles many fonts unless it is
// patched (see padSubsetGlyphs), and fontkit can't lay out some others at all, so only
// fonts checked with `npm run check:fonts` go in the catalog (fontCatalog.ts).

export type { FontFamily } from './fontCatalog';
export { fontFeatures } from './fontkitFixes';

export interface FontStyle {
  family: FontFamily;
  bold: boolean;
  /** Ignored for a family without italics (see hasItalic). */
  italic: boolean;
}

type FontKey = `${FontFamily}-${'regular' | 'bold' | 'italic' | 'boldItalic'}`;

/** Whether a family has real italics. Others aren't slanted: the browser's fake slant wouldn't match the PDF. */
export function hasItalic(family: FontFamily): boolean {
  return FONT_FAMILIES[family].italic !== undefined;
}

/** CSS font-family name a font is registered under (family ids are plain words, so no quotes needed). */
export function cssFamily(family: FontFamily): string {
  return `PDForge ${family}`;
}

export interface LoadedFont {
  bytes: Uint8Array;
  font: Font;
}

/** fontkit is large and only needed once text is placed, so it's loaded on demand. */
export async function loadFontkit() {
  return (await import('@pdf-lib/fontkit')).default;
}

export function fontKey({ family, bold, italic }: FontStyle): FontKey {
  const slanted = italic && hasItalic(family);
  return `${family}-${slanted ? (bold ? 'boldItalic' : 'italic') : bold ? 'bold' : 'regular'}`;
}

function fontUrl(style: FontStyle): string {
  const info = FONT_FAMILIES[style.family];
  if (style.italic && info.italic && info.boldItalic) return style.bold ? info.boldItalic : info.italic;
  return style.bold ? info.bold : info.regular;
}

const cache = new Map<FontKey, Promise<LoadedFont>>();
const loaded = new Map<FontKey, LoadedFont>();

/** A font that has finished loading, or undefined. Lets a switch to it show without a blank frame. */
export function peekFont(style: FontStyle): LoadedFont | undefined {
  return loaded.get(fontKey(style));
}

export function loadFont(style: FontStyle): Promise<LoadedFont> {
  const key = fontKey(style);
  let loading = cache.get(key);
  if (!loading) {
    loading = (async () => {
      const response = await fetch(fontUrl(style));
      if (!response.ok) throw new Error(`Could not load font ${key}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const face = new FontFace(cssFamily(style.family), bytes.slice(), {
        weight: style.bold ? '700' : '400',
        style: style.italic && hasItalic(style.family) ? 'italic' : 'normal',
      });
      document.fonts.add(await face.load());
      const font = (await loadFontkit()).create(bytes);
      // before anything is embedded: every export loads its fonts through here
      padSubsetGlyphs(font);
      const result = { bytes, font };
      loaded.set(key, result);
      return result;
    })();
    // let a failed load be retried later
    loading.catch(() => cache.delete(key));
    cache.set(key, loading);
  }
  return loading;
}

/** Default distance between baselines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayout {
  lines: string[];
  /** Where each line starts, from the left of the box, in points (set by the alignment). */
  lineOffsets: number[];
  /** Box size in points. */
  width: number;
  height: number;
  /** Distance from the top of the box to the first baseline, in points. */
  ascent: number;
  /** Baseline-to-baseline distance, in points. */
  lineHeight: number;
}

export function layoutText(font: Font, text: string, size: number, align: TextAlign = 'left', lineSpacing = LINE_HEIGHT): TextLayout {
  const scale = size / font.unitsPerEm;
  const lines = text.split('\n');
  const widths = lines.map((line) =>
    font.layout(line, fontFeatures).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * scale,
  );
  const ascent = font.ascent * scale;
  const descent = Math.abs(font.descent) * scale;
  const lineHeight = size * lineSpacing;
  const width = Math.max(...widths, size * 0.5);
  const share = align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
  return {
    lines,
    lineOffsets: widths.map((lineWidth) => (width - lineWidth) * share),
    width,
    height: ascent + descent + (lines.length - 1) * lineHeight,
    ascent,
    lineHeight,
  };
}
