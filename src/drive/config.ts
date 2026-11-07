// Google Drive is on in builds that are given a Google Cloud OAuth client: set VITE_GOOGLE_CLIENT_ID,
// VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID (the project number) in .env.production, or in the
// environment of the build. None of them are secrets: they end up in the page anyway, and the
// restrictions set on them in Google Cloud (origins, referrers, APIs) are what protect them.
// Without them the Drive buttons stay hidden and the Content Security Policy stays as strict as ever.

export const driveConfig = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY as string | undefined,
  appId: import.meta.env.VITE_GOOGLE_APP_ID as string | undefined,
};

export const driveEnabled = Boolean(driveConfig.clientId && driveConfig.apiKey && driveConfig.appId);

/** A file in Drive that PDForge opened or saved, so it can be saved over later. */
export interface DriveRef {
  id: string;
  name: string;
  /** The folder it is in, where a copy saved as a new file goes. */
  folder?: string;
}
