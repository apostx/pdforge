import { useEffect, useState } from 'react';

// Chrome (and so ChromeOS) offers installing the site as an app; this captures that offer
// so the app can show its own button. Not in the standard DOM typings yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** A function that opens the browser's install dialog, or null when installing isn't on offer. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const offer = (e: Event) => {
      e.preventDefault(); // keep it for our button instead of the browser's mini-infobar
      setEvent(e as BeforeInstallPromptEvent);
    };
    const installed = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!event) return null;
  return async () => {
    await event.prompt();
    await event.userChoice;
    setEvent(null); // the offer can only be used once
  };
}
