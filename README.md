# PDForge

PDF tools that run entirely in the browser, hosted on GitHub Pages. Files never leave the device.

- Merge PDFs and images into one PDF
- Reorder (drag & drop or keyboard), rotate and remove pages
- Download all pages, or only the selected ones (extract / split)
- Photos are placed on A4 pages or on pages sized to the image; EXIF rotation is respected
- Page editor: place text, images and cover boxes on any page; move, resize and nudge them
  with mouse, touch or keyboard. Zoom in (Ctrl + wheel, touchpad or touch-screen pinch, the
  + / − / 0 keys, or the zoom menu: whole page, page width, 25–400%) to place things exactly
- Text in 24 fonts, all with full Hungarian support: sans-serif, serif, monospaced and
  handwriting, including stand-ins with the same letter widths as Arial, Calibri,
  Times New Roman, Georgia and Courier New for filling in forms. Bold, italic (where the font
  has one), left / centred / right alignment and line spacing. The exported PDF looks exactly
  like the editor; fonts load only when first used
- Zoomed far in, the part of the page in view is rendered at full screen resolution, so small
  print stays sharp; on phones the editor's bar is compact and the zoom controls float over the page
- Signatures: draw one, type it in a handwriting font, or clean up photos and scans of it
  (a sheet holding several signatures is cut into separate ones); keep them in the browser
  (optionally encrypted with a PIN: PBKDF2 + AES-GCM), back them up to a file, and place
  them with quick settings such as "last page, bottom right"
- Signature variants: same-named signatures are variants of one signature and take turns
  when placed on several pages, so no two look copied
- Undo / redo (Ctrl+Z, Ctrl+Y) for page changes and edits
- Work is kept across reloads: files and edits stay in the browser (IndexedDB, this device only)
  until removed or the "Keep after reload" switch is turned off; one tab at a time keeps its work
- Editable PDFs: exported files open again in PDForge with their texts, images and boxes as
  editable items, yet are ordinary PDFs everywhere else and hardly bigger. PDForge's additions
  sit in their own content streams, described in the catalog's `/PieceInfo` (the PDF spec's place
  for an application's own data) with a hash of each original page, so they can be taken off
  again; a file changed by another program since opens as a plain PDF. See
  [src/pdf/editable.ts](src/pdf/editable.ts)
- Compression on export (200 / 150 / 100 dpi) for added photos and for the pictures inside
  existing PDFs (scans), done in a Web Worker
- Google Drive (in builds set up for it): add PDFs and pictures from Drive with Google's picker,
  and save the result back, over the file it came from or as a new file next to it; saved
  editable, the edits come back when the file is opened from Drive again. Only the `drive.file`
  scope: PDForge reaches just the files picked or saved with it. The sign-in token stays in memory
- Installable app (PWA): works offline, and once installed opens PDFs and pictures from the
  file manager
- Strict Content Security Policy in builds, so no outside code can reach stored signatures. With
  Google Drive set up, the policy also lets in Google's sign-in, picker and Drive API (they load
  only once Drive is used); without it the policy stays as strict as ever
- Built for modest hardware: photos are kept as file references rather than in memory,
  thumbnails are decoded small, and documents made only of JPEG photos are written straight
  from the files (no copying), so hundreds of megabytes of pictures stay workable
- English and Hungarian UI; light, dark and inverted (for light-sensitive users) themes

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

`predev`/`prebuild` copy pdf.js runtime assets (CMaps, standard fonts, wasm decoders) into `public/pdfjs/`.

### Checks

```sh
npm run typecheck
npm run check:fonts   # every catalog font survives PDF embedding intact (run after adding one)
npx playwright install chromium   # once
npm run test:e2e      # end-to-end tests against the production build
```

The end-to-end tests cover the editor's zoom, scrolling and dragging (also on a phone), font
loading, signature tiles, offline fonts, keeping work across reloads, editable PDFs (export,
reopen, edit, export again), and compare every font in the editor with the exported PDF
rendered by pdf.js.

### Fonts

Text fonts are listed in [src/pdf/fontCatalog.ts](src/pdf/fontCatalog.ts). pdf-lib's font
subsetting garbles many fonts as it ships (glyphs go missing or swap); the fix is in
[src/pdf/fontkitFixes.ts](src/pdf/fontkitFixes.ts). To add a font: install its
`@expo-google-fonts/*` package, add it to the catalog and run `npm run check:fonts` and the
end-to-end tests. Only the default fonts are stored for offline use up front
(`PRECACHED_FONTS` in [vite.config.ts](vite.config.ts)); the others are kept after first use.

### Google Drive

Drive is switched on by a Google Cloud OAuth client, given at build time (see
[ROADMAP.md](ROADMAP.md) for the Google Cloud setup):

```sh
# .env.production (none of these are secrets: they end up in the page anyway)
VITE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com
VITE_GOOGLE_API_KEY=…
VITE_GOOGLE_APP_ID=…   # the project number
```

The end-to-end tests build with made-up values and stand in for Google's services
([tests/e2e/drive.spec.ts](tests/e2e/drive.spec.ts)); signing in for real is checked by hand.

## Deployment

The site is built locally and published to the `gh-pages` branch, which GitHub Pages serves
(**Settings → Pages → Source: Deploy from a branch, `gh-pages`, `/ (root)`**):

```sh
npm run deploy     # build, then commit dist/ to gh-pages and push it
```

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) can build and deploy with GitHub Actions
instead; it is currently only started by hand (see the comment in the file for switching back).

## Built with

[pdf-lib](https://pdf-lib.js.org/) (writing PDFs), [PDF.js](https://mozilla.github.io/pdf.js/) (previews),
[dnd-kit](https://dndkit.com/) (sorting), React and Vite; tested with [Playwright](https://playwright.dev/).
Text fonts: Open Sans, Arimo, Carlito, Roboto, Noto Sans, Inter, Source Sans 3, Montserrat,
Roboto Condensed, Source Serif 4, Tinos, Gelasio, Noto Serif, PT Serif, Lora, EB Garamond,
Playfair Display, Cousine, Roboto Mono, Source Code Pro, Caveat, Dancing Script, Kalam and
Comic Neue; typed signatures use Dancing Script, Sacramento and Caveat. All from
[Google Fonts](https://fonts.google.com/) under the SIL Open Font License.

Plans and ideas for later are in [ROADMAP.md](ROADMAP.md).
