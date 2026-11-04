import type { Font } from '@pdf-lib/fontkit';

// Kept free of Vite-only imports, so scripts/check-fonts.mjs can run it under Node as well.

/**
 * OpenType features for every text layout, in the editor (fontkit) and in the PDF (pdf-lib).
 * The editor draws text with `font-variant-ligatures: none`, which turns off ligatures and
 * contextual alternates in the browser; fontkit applies them by default, so they're turned off
 * here too. Otherwise a font like Inter shows "<=>" as typed in the editor but writes "⇔" in the PDF.
 */
export const fontFeatures = { liga: false, clig: false, calt: false };

interface TrueTypeSubset {
  glyf: Uint8Array[];
  offset: number;
  _addGlyph(glyphId: number): number;
}

type BufferType = (new (size: number) => Uint8Array) & { alloc?: (size: number) => Uint8Array };

const patched = new WeakSet<object>();

/**
 * Fixes fontkit's TrueType subsetter, which pdf-lib uses to embed fonts.
 *
 * It copies each glyph's bytes as they are, and for a small subset it writes the short `loca`
 * table format, which stores every offset halved. A glyph of odd length (common in fonts that
 * use the long format: Noto, Inter, Arimo, Merriweather and many more) makes all following
 * offsets odd, halving rounds them down, and from there on glyphs are read from the wrong
 * place: letters go missing or turn into others in the PDF. Padding each glyph to an even
 * length, which the TrueType spec allows, keeps every offset even.
 *
 * The subsetter class isn't exported, so its prototype is reached through a subset of a
 * loaded font. Safe to call for every font; CFF fonts use another subsetter and are left alone.
 */
export function padSubsetGlyphs(font: Font): void {
  const prototype = Object.getPrototypeOf(font.createSubset()) as Partial<TrueTypeSubset>;
  const addGlyph = prototype._addGlyph;
  if (typeof addGlyph !== 'function' || patched.has(prototype)) return;
  patched.add(prototype);
  prototype._addGlyph = function (this: TrueTypeSubset, glyphId: number) {
    const index = addGlyph.call(this, glyphId);
    const data = this.glyf[index];
    if (data.length % 2 === 1) {
      // same buffer type as fontkit's own: its output stream rejects others in Node
      const type = data.constructor as BufferType;
      const padded = type.alloc ? type.alloc(data.length + 1) : new type(data.length + 1);
      padded.set(data);
      this.glyf[index] = padded;
      this.offset += 1;
    }
    return index;
  };
}
