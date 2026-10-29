import { languages, useI18n, type Lang } from '../i18n';
import { Icon } from './Icon';
import { useInstallPrompt } from './useInstallPrompt';
import { themeChoices, useTheme, type ThemeChoice } from './useTheme';

export function Header({ onOpenSignatures }: { onOpenSignatures: () => void }) {
  const { lang, setLang, t } = useI18n();
  const { choice, setChoice } = useTheme();
  const install = useInstallPrompt();

  const themeLabels: Record<ThemeChoice, string> = {
    system: t.themeSystem,
    light: t.themeLight,
    dark: t.themeDark,
    invert: t.themeInvert,
  };

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand__logo">
          <Icon name="logo" size={22} />
        </span>
        <div>
          <h1 className="brand__name">PDForge</h1>
          <p className="brand__tagline">{t.tagline}</p>
        </div>
      </div>

      <div className="header-controls">
        {install && (
          <button type="button" className="button" onClick={install} title={t.installHint}>
            <Icon name="download" />
            {t.installApp}
          </button>
        )}
        <button type="button" className="button header-controls__signatures" onClick={onOpenSignatures}>
          <Icon name="signature" />
          {t.signaturesButton}
        </button>
        <label className="field">
          <span className="field__label">{t.language}</span>
          <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
            {languages.map(({ code, name }) => (
              <option key={code} value={code} lang={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t.theme}</span>
          <select value={choice} onChange={(event) => setChoice(event.target.value as ThemeChoice)}>
            {themeChoices.map((value) => (
              <option key={value} value={value}>
                {themeLabels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
