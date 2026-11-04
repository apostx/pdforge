// Checks every font in src/pdf/fontCatalog.ts the way the app uses it: lays out sample text with
// fontkit, embeds it with pdf-lib (subset, as on export), reads the font back out of the saved
// PDF and compares each glyph's outline and width with the original font. Also checks that the
// font has Hungarian ő/ű and that fontkit's layout substitutes nothing (the editor, drawing with
// the browser, wouldn't either). Run after adding a font: npm run check:fonts
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, rgb } from 'pdf-lib';
import { fontFeatures, padSubsetGlyphs } from '../src/pdf/fontkitFixes.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(root);

const SAMPLE = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',
  'Árvíztűrő tükörfúrógép ÁRVÍZTŰRŐ TÜKÖRFÚRÓGÉP őŐűŰ áÁéÉíÍóÓöÖúÚüÜ',
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ „idézet” «» – — … € § © ° ± × ÷',
  'fi fl ff ffi <= >= => -> www äÄßçÇñÑøØåÅ ąćęłńśźżčďěňřšťžůý',
];
const REQUIRED = 'őŐűŰáÁéÉíÍóÓöÖúÚüÜ';

const catalog = readFileSync(new URL('../src/pdf/fontCatalog.ts', import.meta.url), 'utf8');
const files = [...catalog.matchAll(/from '(@expo-google-fonts\/[^']+\.ttf)\?url'/g)].map((match) => match[1]);
if (files.length === 0) throw new Error('No fonts found in fontCatalog.ts');

const decode = (stream) => (stream.dict.get(PDFName.of('Filter')) ? inflateSync(stream.contents) : stream.contents);

async function check(file) {
  const bytes = readFileSync(require.resolve(file));
  const font = fontkit.create(bytes);
  padSubsetGlyphs(font);
  const problems = [];

  const missing = [...REQUIRED].filter((char) => !font.hasGlyphForCodePoint(char.codePointAt(0)));
  if (missing.length > 0) problems.push(`missing ${missing.join('')}`);

  // only characters the font has: the rest would show its "missing" box both on screen and in the PDF
  const lines = SAMPLE.map((line) => [...line].filter((char) => char === ' ' || font.hasGlyphForCodePoint(char.codePointAt(0))).join(''));
  const laidOut = lines.map((line) => font.layout(line, fontFeatures).glyphs);
  lines.forEach((line, index) => {
    const plain = [...line].map((char) => font.glyphForCodePoint(char.codePointAt(0)).id).join();
    if (laidOut[index].map((glyph) => glyph.id).join() !== plain) problems.push(`layout substitutes glyphs in "${line}"`);
  });

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedded = await doc.embedFont(bytes, { subset: true, features: fontFeatures });
  const page = doc.addPage([1200, 300]);
  lines.forEach((line, index) => page.drawText(line, { x: 10, y: 260 - index * 40, size: 20, font: embedded, color: rgb(0, 0, 0) }));
  const saved = await PDFDocument.load(await doc.save());

  // the subset font program, and the glyph ids the page's text uses (in order)
  let subsetBytes;
  for (const [, object] of saved.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue;
    subsetBytes = decode(saved.context.lookup(object.get(PDFName.of('FontFile2'))));
  }
  const contents = saved.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => saved.context.lookup(ref)) : [contents];
  const content = streams.map((stream) => new TextDecoder('latin1').decode(decode(stream))).join('\n');
  const usedIds = [...content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].flatMap(([, hex]) => hex.match(/.{4}/g)?.map((id) => parseInt(id, 16)) ?? []);
  const subset = fontkit.create(subsetBytes);

  const originals = laidOut.flat();
  if (usedIds.length !== originals.length) problems.push(`PDF has ${usedIds.length} glyphs, expected ${originals.length}`);
  const broken = new Set();
  originals.forEach((glyph, index) => {
    const copy = subset.getGlyph(usedIds[index]);
    if (copy.path.toSVG() !== glyph.path.toSVG() || copy.advanceWidth !== glyph.advanceWidth) {
      broken.add(String.fromCodePoint(...glyph.codePoints) || `#${glyph.id}`);
    }
  });
  if (broken.size > 0) problems.push(`glyphs changed in the PDF: ${[...broken].join(' ')}`);
  return problems;
}

let failed = 0;
for (const file of files) {
  let problems;
  try {
    problems = await check(file);
  } catch (error) {
    problems = [`error: ${error.message}`];
  }
  const name = file.split('/').pop();
  console.log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${name}${problems.length ? `: ${problems.join('; ')}` : ''}`);
  if (problems.length > 0) failed++;
}
console.log(failed === 0 ? `\nAll ${files.length} font files are fine.` : `\n${failed} of ${files.length} font files have problems.`);
process.exitCode = failed === 0 ? 0 : 1;
