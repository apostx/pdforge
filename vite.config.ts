import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Google's hosts, allowed only in builds with Google Drive set up (VITE_GOOGLE_* in .env files):
 * the sign-in (Google Identity Services) and the file picker are scripts and frames Google serves,
 * and Drive's API is called from the page. They load only once someone uses Drive.
 */
const GOOGLE = {
  script: ['https://accounts.google.com', 'https://apis.google.com'],
  frame: ['https://accounts.google.com', 'https://docs.google.com', 'https://drive.google.com'],
  connect: ['https://accounts.google.com', 'https://www.googleapis.com', 'https://content.googleapis.com'],
  // the picker's dialog in this page is styled by Google's own style sheets and inline styles
  style: ['https://accounts.google.com', 'https://apis.google.com', 'https://ssl.gstatic.com', "'unsafe-inline'"],
  img: ['https://ssl.gstatic.com', 'https://www.gstatic.com', 'https://lh3.googleusercontent.com'],
};

/**
 * A strict Content Security Policy for the built app (the dev server needs inline scripts).
 * Signatures live in this origin's storage, so no outside code may run here: scripts only from
 * our own files, plus a hash for the small inline theme script; with Google Drive set up, also
 * Google's (see GOOGLE above).
 */
function contentSecurityPolicy(google: boolean): Plugin {
  return {
    name: 'pdforge-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inlineHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          ([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`,
        );
        const extra = (kind: keyof typeof GOOGLE) => (google ? ` ${GOOGLE[kind].join(' ')}` : '');
        const policy = [
          "default-src 'self'",
          // wasm: pdf.js decodes some image formats with WebAssembly
          `script-src 'self' 'wasm-unsafe-eval' ${inlineHashes.join(' ')}${extra('script')}`,
          // React sets style props through the CSSOM, which CSP doesn't restrict
          `style-src 'self'${extra('style')}`,
          `img-src 'self' blob: data:${extra('img')}`,
          "font-src 'self' blob: data:",
          `connect-src 'self' blob: data:${extra('connect')}`,
          ...(google ? [`frame-src${extra('frame')}`] : []),
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

/**
 * Fonts kept for offline use from the start: the default text fonts (src/pdf/fontCatalog.ts)
 * and the handwriting fonts typed signatures use (src/signatures/typed.ts). The rest of the
 * catalog is several megabytes that most people never use, so each font is fetched and kept
 * the first time a text uses it.
 */
const PRECACHED_FONTS = [
  'OpenSans_400Regular',
  'OpenSans_700Bold',
  'SourceSerif4_400Regular',
  'SourceSerif4_700Bold',
  'DancingScript_400Regular',
  'Sacramento_400Regular',
  'Caveat_400Regular',
];

/** Writes dist/sw.js from src/service-worker.js, listing every file to keep for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'pdforge-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const fontName = (path: string) => /^assets\/(.+)-[\w-]{8}\.ttf$/.exec(path)?.[1];
      const bundled = Object.keys(bundle);
      const missing = PRECACHED_FONTS.filter((font) => !bundled.some((path) => fontName(path) === font));
      // a renamed font file would otherwise quietly stop working offline
      if (missing.length > 0) this.error(`Precached fonts not found in the bundle: ${missing.join(', ')}`);
      const precached = bundled.filter((path) => !path.endsWith('.ttf') || PRECACHED_FONTS.includes(fontName(path) ?? ''));
      const publicDir = join(import.meta.dirname, 'public');
      // pdf.js's standard fonts and image decoders are kept so PDFs render offline too; its CMaps
      // (only needed for Chinese, Japanese and Korean text) are many, so they're cached on first use
      const publicFiles = listFiles(publicDir)
        .map((path) => relative(publicDir, path).replaceAll('\\', '/'))
        .filter((path) => !path.startsWith('pdfjs/cmaps/') && path !== 'CNAME');
      // index.html is added to the bundle after this hook runs, so it's listed by hand
      const names = new Set([...precached, ...publicFiles, 'index.html']);
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_GOOGLE_');
  const google = Boolean(env.VITE_GOOGLE_CLIENT_ID && env.VITE_GOOGLE_API_KEY && env.VITE_GOOGLE_APP_ID);
  return {
    // relative base so the build works under https://<user>.github.io/<repo>/
    base: './',
    plugins: [react(), contentSecurityPolicy(google), serviceWorker()],
    // fontkit and pdf.js are large chunks, but they only load when needed
    build: { chunkSizeWarningLimit: 1000 },
  };
});
