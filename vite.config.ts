import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A strict Content Security Policy for the built app (the dev server needs inline scripts).
 * Signatures live in this origin's storage, so no outside code may ever run here: scripts
 * only from our own files, plus a hash for the small inline theme script.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'pdforge-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inlineHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          ([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`,
        );
        const policy = [
          "default-src 'self'",
          // wasm: pdf.js decodes some image formats with WebAssembly
          `script-src 'self' 'wasm-unsafe-eval' ${inlineHashes.join(' ')}`,
          // React sets style props through the CSSOM, which CSP doesn't restrict
          "style-src 'self'",
          "img-src 'self' blob: data:",
          "font-src 'self' blob: data:",
          "connect-src 'self' blob: data:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; ');
        return html.replace(/<meta charset="UTF-8" \/>/, `$&\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Writes dist/sw.js from src/service-worker.js, listing every file to keep for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'pdforge-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicDir = join(import.meta.dirname, 'public');
      // pdf.js's standard fonts and image decoders are kept so PDFs render offline too; its CMaps
      // (only needed for Chinese, Japanese and Korean text) are many, so they're cached on first use
      const publicFiles = listFiles(publicDir)
        .map((path) => relative(publicDir, path).replaceAll('\\', '/'))
        .filter((path) => !path.startsWith('pdfjs/cmaps/'));
      // index.html is added to the bundle after this hook runs, so it's listed by hand
      const names = new Set([...Object.keys(bundle), ...publicFiles, 'index.html']);
      const files = ['./', ...[...names].sort().map((path) => `./${path}`)];
      const hash = createHash('sha256');
      for (const file of files) hash.update(file);
      for (const file of publicFiles) hash.update(readFileSync(join(publicDir, file)));
      const version = `${Date.now()}-${hash.digest('hex').slice(0, 12)}`;

      const source = readFileSync(join(import.meta.dirname, 'src/service-worker.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(files, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  plugins: [react(), contentSecurityPolicy(), serviceWorker()],
  // fontkit and pdf.js are large chunks, but they only load when needed
  build: { chunkSizeWarningLimit: 1000 },
});
