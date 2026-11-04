# Roadmap

Ideas for later rounds. Nothing here is started yet.

## Google Drive

Work on files that live in Google Drive, the way Drive's own editor apps do:

- **Open from and save to Drive.** Pick PDFs and pictures from Drive, and save the result back
  (as a new file or over the original). The `drive.file` scope is enough: it only reaches files
  the user picks or that PDForge created, and Google treats it as non-sensitive.
- **"Open with PDForge" in Drive.** Register PDForge as a Drive app, so a PDF's context menu in
  Drive opens it straight in the editor.
- **Keep the edits with the file.** Store the editing state next to the file (for example as an
  editable PDF, or in the file's `appProperties` plus a small app-data file), so reopening the
  file later continues the editing where it was left.
- **Constraints to solve first:**
  - The strict Content Security Policy only allows our own scripts, so that nothing from outside
    can reach stored signatures. Google's client libraries are scripts from Google's servers.
    Better to call the Drive REST API with `fetch` and sign in with OAuth (PKCE) in a popup or
    redirect, and only open `connect-src` to `https://www.googleapis.com`, keeping `script-src 'self'`.
  - Needs a Google Cloud project, an OAuth client for the GitHub Pages origin, a consent screen,
    and for "Open with" a Drive app listing.
  - Offline: queue saves made while offline and send them once there is a connection.

## Smaller ideas

- Sharper pages at high zoom on big pages: render only the part in view (tiles) instead of the
  whole page, which is capped at 4096 pixels to keep memory use modest.
- Italic text (the fonts have italics; the editor only offers regular and bold).
- On phones the editor's toolbar takes several rows; the zoom controls could float over the page.
- Text alignment and line spacing for multi-line texts.
