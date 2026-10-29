// Offline support. Built into dist/sw.js by the pwa plugin in vite.config.ts, which fills in
// the version and the list of files to keep. This file is not part of the app bundle.

const VERSION = "1793316655231-299ab233e6f3";
const PRECACHE = [
  "./",
  "./apple-touch-icon.png",
  "./assets/Caveat_400Regular-BmQ10ZMN.ttf",
  "./assets/DancingScript_400Regular-BfvM1EuJ.ttf",
  "./assets/OpenSans_400Regular-BYL697sd.ttf",
  "./assets/OpenSans_700Bold-xlJa4yU9.ttf",
  "./assets/PageEditor-pzh-5ash.js",
  "./assets/PlaceSignatureDialog-DJ-xdUMs.js",
  "./assets/Sacramento_400Regular-j1WQUtzH.ttf",
  "./assets/SignatureChooser-DiCW-wxA.js",
  "./assets/SignatureManager-BFPunuVB.js",
  "./assets/SourceSerif4_400Regular-CC0gpOMS.ttf",
  "./assets/SourceSerif4_700Bold-BrJI_OTF.ttf",
  "./assets/buildPdf-BxZKPNwj.js",
  "./assets/compress.worker-BSMhJtxf.js",
  "./assets/es-CqMWid5Y.js",
  "./assets/exportPdf-Cima8mlp.js",
  "./assets/fontkit.es-nZecH4Bu.js",
  "./assets/index-CvyWh8an.css",
  "./assets/index-lMM-ri72.js",
  "./assets/pako-C_KFBokP.js",
  "./assets/pdf.worker.min-CjEcRF4W.mjs",
  "./assets/render-CkAKeky3.js",
  "./assets/rolldown-runtime-XKyaHtl9.js",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512-maskable.png",
  "./icon-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./pdfjs/iccs/CGATS001Compat-v2-micro.icc",
  "./pdfjs/iccs/LICENSE",
  "./pdfjs/standard_fonts/FoxitDingbats.pfb",
  "./pdfjs/standard_fonts/FoxitFixed.pfb",
  "./pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "./pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "./pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "./pdfjs/standard_fonts/FoxitSerif.pfb",
  "./pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "./pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "./pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "./pdfjs/standard_fonts/FoxitSymbol.pfb",
  "./pdfjs/standard_fonts/LICENSE_FOXIT",
  "./pdfjs/standard_fonts/LICENSE_LIBERATION",
  "./pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "./pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "./pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "./pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "./pdfjs/wasm/LICENSE_JBIG2",
  "./pdfjs/wasm/LICENSE_OPENJPEG",
  "./pdfjs/wasm/LICENSE_PDFJS_JBIG2",
  "./pdfjs/wasm/LICENSE_PDFJS_OPENJPEG",
  "./pdfjs/wasm/LICENSE_PDFJS_QCMS",
  "./pdfjs/wasm/LICENSE_QCMS",
  "./pdfjs/wasm/jbig2.wasm",
  "./pdfjs/wasm/jbig2_nowasm_fallback.js",
  "./pdfjs/wasm/openjpeg.wasm",
  "./pdfjs/wasm/openjpeg_nowasm_fallback.js",
  "./pdfjs/wasm/qcms_bg.wasm",
  "./pdfjs/wasm/quickjs-eval.js",
  "./pdfjs/wasm/quickjs-eval.wasm"
];
const CACHE = `pdforge-${VERSION}`;
// cache names start with the build time, so they sort oldest first
const KEEP_VERSIONS = 2;
// Our files never vary by request headers. Ignoring Vary matters: servers may send
// "Vary: Origin", and the page asks for its scripts with an Origin header that the
// install-time requests didn't have, so a strict match would miss them offline.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Keep the previous version too: a page opened before the update may still lazy-load its files.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const ours = keys.filter((key) => key.startsWith('pdforge-')).sort();
        return Promise.all(ours.slice(0, -KEEP_VERSIONS).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // the page itself: network first, so a new version arrives as soon as there is a connection
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('./', MATCH)) ?? caches.match('./index.html', MATCH)),
    );
    return;
  }

  // everything else has a content hash in its name (or never changes): cache first,
  // and keep anything fetched later, such as the pdf.js font and CMap files
  event.respondWith(
    caches.match(request, MATCH).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
