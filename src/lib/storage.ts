// localStorage can be missing or throw (private mode, blocked site data), so settings
// are best-effort: the app works the same, the choice just isn't remembered.

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
