import { driveConfig, type DriveRef } from './config';

// Talks to Google: sign-in with Google Identity Services (an access token for the drive.file
// scope, held in memory only), Google's file picker, and Drive's REST API for reading and
// writing files. Google's scripts are loaded only when Drive is first used.

const GIS_URL = 'https://accounts.google.com/gsi/client';
const GAPI_URL = 'https://apis.google.com/js/api.js';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
/** Files the picker offers: what PDForge can open. */
const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'].join(',');
/** Drive's limit for a one-request ("multipart") upload; bigger files go up in two steps. */
const MULTIPART_LIMIT = 5 * 1024 * 1024;

/** The person closed the sign-in window or the picker: nothing to report. */
export class DriveCancelled extends Error {}

export class DriveError extends Error {}

// Minimal typings for the parts of Google's libraries used here.
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
interface PickerDocument {
  id: string;
  name: string;
  mimeType: string;
  parentId?: string;
}
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: PickerDocument[] }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string }) => void;
      }): TokenClient;
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId?: string) => { setMimeTypes(types: string): unknown; setIncludeFolders(include: boolean): unknown };
    ViewId: { DOCS: string };
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load(library: string, options: { callback: () => void; onerror: () => void }): void };
  }
}

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let loading = scripts.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new DriveError(`Could not load ${src}`));
      document.head.append(script);
    });
    loading.catch(() => scripts.delete(src));
    scripts.set(src, loading);
  }
  return loading;
}

/** Starts loading Google's scripts ahead of a click (on hover or focus), so the sign-in window isn't blocked. */
export function preloadGoogle(): void {
  void loadScript(GIS_URL).catch(() => {});
  void loadScript(GAPI_URL).catch(() => {});
}

let token: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  await loadScript(GIS_URL);
  const google = window.google!;
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: driveConfig.clientId!,
      scope: SCOPE,
      callback: (response) => {
        if (!response.access_token) return reject(new DriveError(response.error ?? 'No access token'));
        token = { value: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (error) =>
        reject(error.type === 'popup_closed' ? new DriveCancelled() : new DriveError(`Sign-in failed: ${error.type}`)),
    });
    // asks again only if needed (the first time, or after access was taken back)
    client.requestAccessToken({ prompt: '' });
  });
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async () => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } });
  let response = await send();
  if (response.status === 401) {
    // the token ran out or was taken back: sign in again once
    token = null;
    response = await send();
  }
  if (!response.ok) throw new DriveError(`Drive answered ${response.status}`);
  return response;
}

export interface PickedFile extends DriveRef {
  mimeType: string;
}

/** Lets the person choose files in Google's picker; null if they cancel. */
export async function pickFiles(locale: string): Promise<PickedFile[] | null> {
  const oauthToken = await accessToken();
  await loadScript(GAPI_URL);
  await new Promise<void>((resolve, reject) =>
    window.gapi!.load('picker', { callback: resolve, onerror: () => reject(new DriveError('Could not load the picker')) }),
  );
  const { picker } = window.google!;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setMimeTypes(MIME_TYPES);
    view.setIncludeFolders(true);
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(oauthToken)
      .setDeveloperKey(driveConfig.apiKey!)
      .setAppId(driveConfig.appId!)
      .setLocale(locale)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          resolve((data.docs ?? []).map((doc) => ({ id: doc.id, name: doc.name, mimeType: doc.mimeType, folder: doc.parentId })));
        } else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

export async function downloadFile(file: PickedFile): Promise<File> {
  const response = await driveFetch(`${API}/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
  return new File([await response.blob()], file.name, { type: file.mimeType });
}

/**
 * Saves a PDF to Drive: over `replace` when given, otherwise as a new file named `name` (in
 * `folder`, or at the top of My Drive). Returns the file as Drive now has it.
 */
export async function uploadPdf(pdf: Blob, name: string, replace: DriveRef | null, folder?: string): Promise<DriveRef> {
  const metadata = replace ? {} : { name, mimeType: 'application/pdf', ...(folder ? { parents: [folder] } : {}) };
  const path = replace ? `/upload/drive/v3/files/${encodeURIComponent(replace.id)}` : '/upload/drive/v3/files';
  const method = replace ? 'PATCH' : 'POST';
  const multipart = () => {
    const boundary = `pdforge-${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
      pdf,
      `\r\n--${boundary}--`,
    ]);
    return driveFetch(`${API}${path}?uploadType=multipart&fields=id,name,parents`, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  };
  let response: Response;
  if (pdf.size <= MULTIPART_LIMIT) {
    response = await multipart();
  } else {
    // big files: start an upload session, then send the file to the address it gives
    const session = await driveFetch(`${API}${path}?uploadType=resumable&fields=id,name,parents`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf' },
      body: JSON.stringify(metadata),
    });
    const location = session.headers.get('Location');
    // (should the browser not be shown the address, one request it is)
    response = location ? await driveFetch(location, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf }) : await multipart();
  }
  const saved = (await response.json()) as { id: string; name: string; parents?: string[] };
  return { id: saved.id, name: saved.name, folder: saved.parents?.[0] ?? folder ?? replace?.folder };
}

/** Address of a file in Drive's own viewer. */
export function driveFileUrl(file: DriveRef): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`;
}
