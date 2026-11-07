import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { photoJpg } from './fixtures';
import { samplePdf } from './helpers';

// Google Drive against stand-ins for Google: the sign-in library, the picker and Drive's REST API
// are replaced by small fakes that follow their documented shapes. (Real sign-in needs a person,
// so that part is checked by hand on the live site.) Needs a build with VITE_GOOGLE_* set, as
// playwright.config.ts makes.

test.use({ viewport: { width: 1280, height: 800 } });

const GIS = `
  window.google = window.google || {};
  window.google.accounts = { oauth2: { initTokenClient(config) {
    window.__clientId = config.client_id; window.__scope = config.scope;
    return { requestAccessToken() {
      window.__signIns = (window.__signIns || 0) + 1;
      setTimeout(() => window.__denySignIn
        ? config.error_callback({ type: 'popup_closed' })
        : config.callback({ access_token: 'token-' + window.__signIns, expires_in: 3600 }), 0);
    } };
  } } };`;
const GAPI = `
  window.gapi = { load(name, options) { setTimeout(options.callback, 0); } };
  window.google = window.google || {};
  window.google.picker = {
    ViewId: { DOCS: 'all' }, Feature: { MULTISELECT_ENABLED: 'multiselect' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
    DocsView: class { setMimeTypes(types) { window.__mimeTypes = types; return this; } setIncludeFolders() { return this; } },
    PickerBuilder: class {
      constructor() { this.options = {}; }
      addView() { return this; }
      enableFeature(feature) { this.options.feature = feature; return this; }
      setOAuthToken(token) { this.options.token = token; return this; }
      setDeveloperKey(key) { this.options.key = key; return this; }
      setAppId(id) { this.options.appId = id; return this; }
      setLocale(locale) { this.options.locale = locale; return this; }
      setCallback(callback) { this.callback = callback; return this; }
      build() { return { setVisible: () => { window.__picker = this.options; setTimeout(() => this.callback(window.__pick || { action: 'cancel' }), 0); } }; }
    },
  };`;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location' };

interface Drive {
  files: Map<string, Buffer>;
  /** Tokens Drive no longer accepts (expired). */
  expired: Set<string>;
  uploads: { method: string; url: string; auth: string | null; body: Buffer }[];
}

async function fakeGoogle(context: BrowserContext): Promise<Drive> {
  const drive: Drive = { files: new Map(), expired: new Set(), uploads: [] };
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: GIS }));
  await context.route('https://apis.google.com/js/api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: GAPI }));
  await context.route('https://www.googleapis.com/**', async (route) => {
    const request: Request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const auth = (await request.allHeaders()).authorization ?? null;
    if (!auth?.startsWith('Bearer token-') || drive.expired.has(auth.slice(7))) return route.fulfill({ status: 401, headers: CORS, body: '{}' });
    const download = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (download && url.searchParams.get('alt') === 'media') {
      const file = drive.files.get(decodeURIComponent(download[1]));
      return file ? route.fulfill({ status: 200, headers: CORS, body: file }) : route.fulfill({ status: 404, headers: CORS, body: '{}' });
    }
    const upload = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
    if (upload) {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      drive.uploads.push({ method: request.method(), url: request.url(), auth, body });
      if (url.searchParams.get('uploadType') === 'resumable' && !url.searchParams.get('upload_id')) {
        return route.fulfill({ status: 200, headers: { ...CORS, Location: `${url.origin}${url.pathname}?uploadType=resumable&upload_id=session-1` }, body: '' });
      }
      const id = upload[1] ? decodeURIComponent(upload[1]) : 'new-file';
      const name = /"name":"([^"]+)"/.exec(body.subarray(0, 2000).toString('latin1'))?.[1] ?? 'contract.pdf';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id, name, parents: ['folder-9'] }) });
    }
    return route.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  return drive;
}

const pick = (page: Page, docs: { id: string; name: string; mimeType: string; parentId?: string }[]) =>
  page.evaluate((picked) => ((window as unknown as { __pick: unknown }).__pick = { action: 'picked', docs: picked }), docs);

async function saveToDrive(page: Page, choice: RegExp | 'As a new file', name?: string) {
  await page.getByRole('button', { name: 'Save to Google Drive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to Google Drive' });
  await dialog.getByRole('radio', { name: choice }).check();
  if (name) await dialog.getByRole('textbox', { name: 'File name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

test('open a PDF from Drive, then save it back over the same file and as a copy', async ({ page, context }) => {
  const drive = await fakeGoogle(context);
  drive.files.set('file-1', await samplePdf());
  await page.goto('/');
  // the policy lets Google's sign-in, picker and API in, in this build only
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain('https://accounts.google.com');
  expect(policy).toContain('https://www.googleapis.com');

  await pick(page, [{ id: 'file-1', name: 'contract.pdf', mimeType: 'application/pdf', parentId: 'folder-9' }]);
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await expect(page.locator('.page-card')).toHaveCount(3);
  expect(await page.evaluate(() => (window as unknown as { __scope: string }).__scope)).toBe('https://www.googleapis.com/auth/drive.file');
  const picker = await page.evaluate(() => (window as unknown as { __picker: Record<string, string> }).__picker);
  expect(picker).toMatchObject({ token: 'token-1', key: 'test-api-key', appId: '123456789', locale: 'en' });

  // saved over the file it came from
  await saveToDrive(page, /Replace “contract\.pdf”/);
  await expect(page.locator('.notice')).toContainText('Saved to Google Drive as “contract.pdf”.');
  await expect(page.locator('.notice a')).toHaveAttribute('href', 'https://drive.google.com/file/d/file-1/view');
  const replaced = drive.uploads.at(-1)!;
  expect(replaced.method).toBe('PATCH');
  expect(replaced.url).toContain('/upload/drive/v3/files/file-1?uploadType=multipart');
  expect(replaced.body.includes('%PDF-')).toBe(true);
  // the metadata part asks for no changes: the name stays the file's own
  expect(replaced.body.subarray(0, 300).toString()).toContain('\r\n\r\n{}\r\n');

  // and as a new file, next to it
  await saveToDrive(page, 'As a new file', 'signed copy');
  const created = drive.uploads.at(-1)!;
  expect(created.method).toBe('POST');
  const metadata = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(created.body.subarray(0, 500).toString())![1]);
  expect(metadata).toEqual({ name: 'signed copy.pdf', mimeType: 'application/pdf', parents: ['folder-9'] });
  // from now on "save" offers to update the copy
  await page.getByRole('button', { name: 'Save to Google Drive' }).click();
  await expect(page.getByRole('radio', { name: /Replace “signed copy\.pdf”/ })).toBeChecked();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // the link to the Drive file is kept across a reload, with the work
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator('.page-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save to Google Drive' }).click();
  await expect(page.getByRole('radio', { name: /Replace “signed copy\.pdf”/ })).toBeChecked();
});

test('a big PDF goes up in an upload session', async ({ page, context }) => {
  const drive = await fakeGoogle(context);
  // a page holding a picture with 6 MB of incompressible data after its end
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(Buffer.concat([photoJpg, randomBytes(6 * 1024 * 1024)]));
  doc.addPage([400, 300]).drawImage(image, { x: 0, y: 0, width: 400, height: 300 });
  drive.files.set('big-1', Buffer.from(await doc.save()));
  await page.goto('/');
  await pick(page, [{ id: 'big-1', name: 'big.pdf', mimeType: 'application/pdf' }]);
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await expect(page.locator('.page-card')).toHaveCount(1);
  await saveToDrive(page, /Replace “big\.pdf”/);
  await expect(page.locator('.notice')).toContainText('Saved to Google Drive');
  const [start, send] = drive.uploads.slice(-2);
  expect(start.url).toContain('uploadType=resumable');
  expect(send.url).toContain('upload_id=session-1');
  expect(send.method).toBe('PUT');
  expect(send.body.length).toBeGreaterThan(6 * 1024 * 1024);
});

test('closing the sign-in changes nothing; a file that fails to download is reported', async ({ page, context }) => {
  const drive = await fakeGoogle(context);
  await page.goto('/');
  await page.evaluate(() => ((window as unknown as { __denySignIn: boolean }).__denySignIn = true));
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.notice')).toHaveCount(0);
  await expect(page.locator('.page-card')).toHaveCount(0);

  await page.evaluate(() => ((window as unknown as { __denySignIn: boolean }).__denySignIn = false));
  drive.files.set('photo-1', photoJpg);
  await pick(page, [
    { id: 'missing-1', name: 'gone.pdf', mimeType: 'application/pdf' },
    { id: 'photo-1', name: 'photo.jpg', mimeType: 'image/jpeg' },
  ]);
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await expect(page.locator('.notice')).toContainText('“gone.pdf” could not be opened from Google Drive.');
  // the other one still came in
  await expect(page.locator('.page-card')).toHaveCount(1);
});

test('an expired sign-in is renewed once, and the save goes through', async ({ page, context }) => {
  const drive = await fakeGoogle(context);
  drive.files.set('file-1', await samplePdf());
  await page.goto('/');
  await pick(page, [{ id: 'file-1', name: 'contract.pdf', mimeType: 'application/pdf' }]);
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await expect(page.locator('.page-card')).toHaveCount(3);
  drive.expired.add('token-1');
  await saveToDrive(page, /Replace “contract\.pdf”/);
  await expect(page.locator('.notice')).toContainText('Saved to Google Drive');
  expect(drive.uploads.at(-1)!.auth).toBe('Bearer token-2');
  expect(await page.evaluate(() => (window as unknown as { __signIns: number }).__signIns)).toBe(2);
});
