# Roadmap

Plans for later rounds.

## Google Drive (built; waiting on the setup below)

Option A was chosen: Google's scripts are let in by the Content Security Policy, in builds with
Drive set up only, and load only once Drive is used.

### Done

1. **Open from Drive**: the "Google Drive" button opens Google's picker (PDFs and pictures, several
   at once); the chosen files are added like local ones.
2. **Save to Drive**: next to "Download PDF". Over the file the work came from (or was last saved
   to), or as a new file in the same folder. Saved editable in PDForge, so reopening it from Drive
   brings every item back. Big files go up in an upload session. The Drive file stays linked
   across reloads, with the kept work.
3. Scope `drive.file` only; sign-in with Google Identity Services, the token held in memory only
   and renewed once when it runs out.

### Still to do

- Try it live once the values below are in (signing in needs a person).
- **"Open with PDForge" in Drive**: a PDF's right-click menu in Drive opens it in the editor. Needs
  a Drive UI integration and a Google Workspace Marketplace listing.
- **Saving while offline**: today it reports the failure (download still works). A queue that
  sends the save once back online is possible while the sign-in is still valid (about an hour);
  after that, signing in again opens a window, which browsers only allow on a click.

### Setup needed from the owner (Google Cloud console, about 15 minutes)

1. Create a project at console.cloud.google.com; enable **Google Drive API** and **Google Picker API**.
2. **OAuth consent screen:** External; app name "PDForge"; a support e-mail; scope `.../auth/drive.file`.
   It can stay in *Testing* with your own account as a test user while trying it; publishing
   it later needs no security review for this scope.
3. **Credentials → OAuth client ID**, type *Web application*, authorised JavaScript origins:
   `https://pdforge.sallai.cc` (the site's own domain), `https://apostx.github.io`,
   `http://localhost:5173`, `http://localhost:4173`.
4. **Credentials → API key**, restricted to the Picker API and to the referrers
   `https://pdforge.sallai.cc/*`, `https://apostx.github.io/pdforge/*` and `http://localhost:*/*`.
5. Hand over the client ID, the API key and the project number. None of them are secrets: they
   end up in the page's code anyway, and the restrictions above are what protect them. They go
   into `.env.production` (see the README).

Signing in needs a person, so the Drive steps get tested live on the site; everything around
them has end-to-end tests with Google's services stood in for.

## Smaller ideas

- Text boxes with a set width that wrap their lines (alignment then lines up with the box edge).
- Draw freehand on the page (ink annotations), and highlight boxes that let the text show through.
- On very large pages, also render the detail view in tiles while scrolling, not only once it stops.
