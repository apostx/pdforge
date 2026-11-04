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
  Times New Roman, Georgia and Courier New for filling in forms. The exported PDF looks exactly
  like the editor; fonts load only when first used
- Signatures: draw one, type it in a handwriting font, or clean up photos and scans of it
  (a sheet holding several signatures is cut into separate ones); keep them in the browser
  (optionally encrypted with a PIN: PBKDF2 + AES-GCM), back them up to a file, and place
  them with quick settings such as "last page, bottom right"
- Signature variants: same-named signatures are variants of one signature and take turns
  when placed on several pages, so no two look copied
- Undo / redo (Ctrl+Z, Ctrl+Y) for page changes and edits
- Compression on export (200 / 150 / 100 dpi) for added photos and for the pictures inside
  existing PDFs (scans), done in a Web Worker
- Installable app (PWA): works offline, and once installed opens PDFs and pictures from the
  file manager
- Strict Content Security Policy in builds, so no outside code can reach stored signatures
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
loading, signature tiles, offline fonts, and compare every font in the editor with the exported
PDF rendered by pdf.js.

### Fonts

Text fonts are listed in [src/pdf/fontCatalog.ts](src/pdf/fontCatalog.ts). pdf-lib's font
subsetting garbles many fonts as it ships (glyphs go missing or swap); the fix is in
[src/pdf/fontkitFixes.ts](src/pdf/fontkitFixes.ts). To add a font: install its
`@expo-google-fonts/*` package, add it to the catalog and run `npm run check:fonts` and the
end-to-end tests. Only the default fonts are stored for offline use up front
(`PRECACHED_FONTS` in [vite.config.ts](vite.config.ts)); the others are kept after first use.

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
