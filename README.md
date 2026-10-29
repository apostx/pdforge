# PDForge

PDF tools that run entirely in the browser, hosted on GitHub Pages. Files never leave the device.

- Merge PDFs and images into one PDF
- Reorder (drag & drop or keyboard), rotate and remove pages
- Download all pages, or only the selected ones (extract / split)
- Photos are placed on A4 pages or on pages sized to the image; EXIF rotation is respected
- Page editor: place text (with full Hungarian character support), images and cover boxes
  on any page; move, resize and nudge them with mouse, touch or keyboard
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
[dnd-kit](https://dndkit.com/) (sorting), React and Vite.
Text is set in [Open Sans](https://fonts.google.com/specimen/Open+Sans) and
[Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4); typed signatures use
[Dancing Script](https://fonts.google.com/specimen/Dancing+Script),
[Sacramento](https://fonts.google.com/specimen/Sacramento) and [Caveat](https://fonts.google.com/specimen/Caveat)
(all SIL Open Font License).
