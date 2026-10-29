import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { SignatureProvider } from './signatures/SignatureProvider';
import './styles.css';

// Offline support and installing as an app; dist/sw.js only exists in builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline support unavailable', error));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SignatureProvider>
        <App />
      </SignatureProvider>
    </I18nProvider>
  </StrictMode>,
);
