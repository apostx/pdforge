import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readSetting, writeSetting } from '../lib/storage';
import { en, type Messages } from './en';
import { hu } from './hu';

export type Lang = 'en' | 'hu';

// Names are shown in their own language so people can find theirs.
export const languages: { code: Lang; name: string }[] = [
  { code: 'hu', name: 'Magyar' },
  { code: 'en', name: 'English' },
];

const catalogs: Record<Lang, Messages> = { en, hu };
const STORAGE_KEY = 'pdforge.lang';

function initialLang(): Lang {
  const stored = readSetting(STORAGE_KEY);
  if (stored === 'en' || stored === 'hu') return stored;
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith('hu')) ? 'hu' : 'en';
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeSetting(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: catalogs[lang] }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}
