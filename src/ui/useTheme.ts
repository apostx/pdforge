import { useCallback, useEffect, useState } from 'react';
import { readSetting, writeSetting } from '../lib/storage';

// 'invert' is for light-sensitive users: black UI and inverted document previews.
// It only changes what is shown on screen, never the exported PDF.
export type ThemeChoice = 'system' | 'light' | 'dark' | 'invert';
export const themeChoices: ThemeChoice[] = ['system', 'light', 'dark', 'invert'];

// Keep in sync with the inline script in index.html.
const STORAGE_KEY = 'pdforge.theme';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function storedChoice(): ThemeChoice {
  const value = readSetting(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'invert' ? value : 'system';
}

export function useTheme() {
  const [choice, setChoice] = useState(storedChoice);
  const [systemDark, setSystemDark] = useState(darkQuery.matches);

  useEffect(() => {
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const changeChoice = useCallback((next: ThemeChoice) => {
    setChoice(next);
    writeSetting(STORAGE_KEY, next);
  }, []);

  return { choice, setChoice: changeChoice };
}
