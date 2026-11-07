# Roadmap

Plans for later rounds.

## Google Drive (next; waiting on the setup below)

Work on files that live in Google Drive, the way Drive's own editor apps do.

### What it does

1. **Open from Drive.** A "Google Drive" button opens Google's file picker; the chosen PDFs and
   pictures are added like local files.
2. **Save to Drive.** Next to "Download PDF": save the result to Drive, as a new file or over the
   file it was opened from. Saved "editable in PDForge" (already built), so opening it from Drive
   later brings back every text, image and box as an editable item: the edits travel inside the
   file itself, and no separate storage is needed.
3. **Later: "Open with PDForge" in Drive.** A PDF's right-click menu in Drive opens it straight
   in the editor. This needs a Drive UI integration and a Google Workspace Marketplace listing,
   so it comes after 1 and 2 work.

### How

- **Scope `drive.file` only.** PDForge can reach only the files the user picks, or that PDForge
  saved. Google counts it as non-sensitive, so no security review is needed. (Browsing Drive
  without the picker would need `drive.readonly`, a restricted scope that needs Google's
  security assessment for public use.)
- **Sign-in with Google Identity Services** in a popup. The access token stays in memory only,
  nothing on a server (there is none), and it is asked for again when it expires.
- **Offline:** saves made while offline wait and go once there is a connection.

### Decision needed: Google's scripts and the strict CSP

The picker and the sign-in are scripts served by Google. Today the Content Security Policy lets
only PDForge's own scripts run, so nothing else can reach the signatures and kept work stored in
this origin. Options:

- **A. Allow Google's scripts** (`apis.google.com`, `accounts.google.com`) in the policy. Simplest,
  and the full picker works; Google's code then runs with the same access as PDForge's.
- **B. A separate "Drive bridge" page on another origin** loads Google's scripts and passes the
  files over with `postMessage`; the main app keeps its strict policy. Needs a second origin:
  GitHub Pages serves every repository of one account from the same origin
  (`apostx.github.io`), so a custom domain for one of them, or another account's Pages site.
- Recommended: **A** to start (smallest, and Google is already trusted for the files themselves),
  with the README's security note updated; **B** if keeping signatures beyond any outside code's
  reach matters more.

### Setup needed from the owner (Google Cloud console, about 15 minutes)

1. Create a project at console.cloud.google.com; enable **Google Drive API** and **Google Picker API**.
2. **OAuth consent screen:** External; app name "PDForge"; a support e-mail; scope `.../auth/drive.file`.
   It can stay in *Testing* with your own account as a test user while trying it; publishing
   it later needs no security review for this scope.
3. **Credentials → OAuth client ID**, type *Web application*, authorised JavaScript origins:
   `https://apostx.github.io`, `http://localhost:5173`, `http://localhost:4173`.
4. **Credentials → API key**, restricted to the Picker API and to the referrers
   `https://apostx.github.io/pdforge/*` and `http://localhost:*/*`.
5. Hand over the client ID, the API key and the project number. None of them are secrets: they
   end up in the page's code anyway, and the restrictions above are what protect them.
6. Choose A or B above.

Signing in needs a person, so the Drive steps get tested live on the site; everything around
them (buttons, saving, the offline queue) gets end-to-end tests with Google's endpoints stubbed.

## Smaller ideas

- Text boxes with a set width that wrap their lines (alignment then lines up with the box edge).
- Draw freehand on the page (ink annotations), and highlight boxes that let the text show through.
- On very large pages, also render the detail view in tiles while scrolling, not only once it stops.
