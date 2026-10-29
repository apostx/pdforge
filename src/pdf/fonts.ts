import type { Font } from '@pdf-lib/fontkit';
import sansRegularUrl from '@expo-google-fonts/open-sans/400Regular/OpenSans_400Regular.ttf?url';
import sansBoldUrl from '@expo-google-fonts/open-sans/700Bold/OpenSans_700Bold.ttf?url';
import serifRegularUrl from '@expo-google-fonts/source-serif-4/400Regular/SourceSerif4_400Regular.ttf?url';
import serifBoldUrl from '@expo-google-fonts/source-serif-4/700Bold/SourceSerif4_700Bold.ttf?url';

// The standard PDF fonts can't encode ő/ű, so text is set in embedded fonts.
// The same font file is used on screen (via FontFace) and in the PDF, and all
// measuring goes through fontkit, so the editor shows exactly what gets exported.
//
// Fonts are subset when embedded, and pdf-lib's subsetter garbles some fonts
// (Noto, Inter and Ubuntu among them: glyphs go missing). Open Sans and Source
// Serif 4 come through intact; check the exported PDF visually before swapping them.

export type FontFamily = 'sans' | 'serif';

export interface FontStyle {
  family: FontFamily;
  bold: boolean;
}

type FontKey = `${FontFamily}-${'regular' | 'bold'}`;

const urls: Record<FontKey, string> = {
  'sans-regular': sansRegularUrl,
  'sans-bold': sansBoldUrl,
  'serif-regular': serifRegularUrl,
  'serif-bold': serifBoldUrl,
};

/** CSS font-family names the fonts are registered under. */
export const cssFamily: Record<FontFamily, string> = {
  sans: 'PDForge Sans',
  serif: 'PDForge Serif',
};

/** Ligatures off everywhere: pdf-lib and the browser would otherwise pick them differently. */
export const fontFeatures = { liga: false };

export interface LoadedFont {
  bytes: Uint8Array;
  font: Font;
}

/** fontkit is large and only needed once text is placed, so it's loaded on demand. */
export async function loadFontkit() {
  return (await import('@pdf-lib/fontkit')).default;
}

export function fontKey({ family, bold }: FontStyle): FontKey {
  return `${family}-${bold ? 'bold' : 'regular'}`;
}

const cache = new Map<FontKey, Promise<LoadedFont>>();

export function loadFont(style: FontStyle): Promise<LoadedFont> {
  const key = fontKey(style);
  let loading = cache.get(key);
  if (!loading) {
    loading = (async () => {
      const response = await fetch(urls[key]);
      if (!response.ok) throw new Error(`Could not load font ${key}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const face = new FontFace(cssFamily[style.family], bytes.slice(), { weight: style.bold ? '700' : '400' });
      document.fonts.add(await face.load());
      return { bytes, font: (await loadFontkit()).create(bytes) };
    })();
    // let a failed load be retried later
    loading.catch(() => cache.delete(key));
    cache.set(key, loading);
  }
  return loading;
}

export const LINE_HEIGHT = 1.25;

export interface TextLayout {
  lines: string[];
  /** Box size in points. */
  width: number;
  height: number;
  /** Distance from the top of the box to the first baseline, in points. */
  ascent: number;
  /** Baseline-to-baseline distance, in points. */
  lineHeight: number;
}

export function layoutText(font: Font, text: string, size: number): TextLayout {
  const scale = size / font.unitsPerEm;
  const lines = text.split('\n');
  const widths = lines.map((line) =>
    font.layout(line, fontFeatures).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * scale,
  );
  const ascent = font.ascent * scale;
  const descent = Math.abs(font.descent) * scale;
  const lineHeight = size * LINE_HEIGHT;
  return {
    lines,
    width: Math.max(...widths, size * 0.5),
    height: ascent + descent + (lines.length - 1) * lineHeight,
    ascent,
    lineHeight,
  };
}
