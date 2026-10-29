// pdf.js fetches these at runtime (CMaps, standard fonts, wasm decoders, ICC profiles),
// so they have to be served next to the app.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

rmSync(to, { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(from, dir), join(to, dir), { recursive: true });
}
