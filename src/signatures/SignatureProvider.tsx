import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { imageObjectUrl, type PreparedImage } from '../pdf/images';
import type { PlacementPreset } from './presets';
import * as store from './store';

export interface Signature {
  id: string;
  name: string;
  createdAt: number;
  image: PreparedImage;
  /** Object URL of the image, for display. */
  url: string;
}

export type LibraryStatus = 'loading' | 'locked' | 'ready' | 'unavailable';

interface SignatureLibrary {
  status: LibraryStatus;
  /** Whether a PIN protects the library. */
  encrypted: boolean;
  signatures: Signature[];
  presets: PlacementPreset[];
  /** True while a slow key derivation or re-encryption is running. */
  busy: boolean;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  add: (data: store.SignatureData) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  removePin: () => Promise<void>;
  /** Deletes every signature and the PIN: the way out when the PIN is forgotten. */
  reset: () => Promise<void>;
  exportBackup: () => Promise<Blob>;
  /** Adds the signatures from a backup; `pin` is the backup's PIN if it was encrypted. Returns how many were added. */
  importBackup: (text: string, pin?: string) => Promise<number>;
  backupNeedsPin: (text: string) => boolean;
  savePreset: (preset: PlacementPreset) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
}

const SignatureContext = createContext<SignatureLibrary | null>(null);

export class WrongPinError extends Error {}

function toSignature(record: store.StoredSignature, data: store.SignatureData): Signature {
  const image: PreparedImage = { bytes: data.png, format: 'png', width: data.width, height: data.height };
  return { id: record.id, name: data.name, createdAt: record.createdAt, image, url: imageObjectUrl(image) };
}

function revokeAll(signatures: Signature[]) {
  for (const signature of signatures) URL.revokeObjectURL(signature.url);
}

export function SignatureProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LibraryStatus>('loading');
  const [vault, setVault] = useState<store.Vault | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [presets, setPresets] = useState<PlacementPreset[]>([]);
  const [busy, setBusy] = useState(false);
  // The key exists only in memory, and only while unlocked.
  const key = useRef<CryptoKey | null>(null);
  const records = useRef<store.StoredSignature[]>([]);

  const replaceSignatures = useCallback((next: Signature[]) => {
    setSignatures((current) => {
      revokeAll(current.filter((signature) => !next.includes(signature)));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    store
      .loadAll()
      .then(async (loaded) => {
        if (cancelled) return;
        records.current = loaded.signatures;
        setVault(loaded.vault);
        setPresets(loaded.presets as unknown as PlacementPreset[]);
        if (loaded.vault) {
          setStatus('locked');
          return;
        }
        const opened = await Promise.all(loaded.signatures.map(async (r) => toSignature(r, await store.openSignature(r, null))));
        if (!cancelled) {
          replaceSignatures(opened);
          setStatus('ready');
        }
      })
      .catch((error) => {
        // e.g. storage blocked in a private window
        console.error('Signature storage unavailable', error);
        if (!cancelled) setStatus('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [replaceSignatures]);

  const withBusy = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await work();
    } finally {
      setBusy(false);
    }
  }, []);

  const unlock = useCallback(
    (pin: string) =>
      withBusy(async () => {
        if (!vault) return true;
        const unlocked = await store.unlockVault(vault, pin);
        if (!unlocked) return false;
        key.current = unlocked;
        const opened = await Promise.all(records.current.map(async (r) => toSignature(r, await store.openSignature(r, unlocked))));
        replaceSignatures(opened);
        setStatus('ready');
        return true;
      }),
    [vault, withBusy, replaceSignatures],
  );

  const lock = useCallback(() => {
    if (!vault) return;
    key.current = null;
    replaceSignatures([]);
    setStatus('locked');
  }, [vault, replaceSignatures]);

  const add = useCallback(
    async (data: store.SignatureData) => {
      const record = await store.sealSignature(data, key.current, crypto.randomUUID(), Date.now());
      await store.putSignature(record);
      records.current = [...records.current, record];
      setSignatures((current) => [...current, toSignature(record, data)]);
      // ask the browser not to clear our storage under pressure (granted silently or not at all)
      void navigator.storage?.persist?.();
    },
    [],
  );

  const rename = useCallback(async (id: string, name: string) => {
    const index = records.current.findIndex((record) => record.id === id);
    if (index < 0) return;
    const old = records.current[index];
    const data = await store.openSignature(old, key.current);
    const record = await store.sealSignature({ ...data, name }, key.current, id, old.createdAt);
    await store.putSignature(record);
    records.current = records.current.map((r) => (r.id === id ? record : r));
    setSignatures((current) => current.map((signature) => (signature.id === id ? { ...signature, name } : signature)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await store.deleteSignature(id);
    records.current = records.current.filter((record) => record.id !== id);
    setSignatures((current) => {
      revokeAll(current.filter((signature) => signature.id === id));
      return current.filter((signature) => signature.id !== id);
    });
  }, []);

  /** Re-writes every signature under a new key (or none). Requires the library to be unlocked. */
  const rekey = useCallback(async (nextKey: CryptoKey | null, nextVault: store.Vault | null) => {
    const resealed = await Promise.all(
      records.current.map(async (record) =>
        store.sealSignature(await store.openSignature(record, key.current), nextKey, record.id, record.createdAt),
      ),
    );
    await store.replaceAll(resealed, nextVault);
    records.current = resealed;
    key.current = nextKey;
    setVault(nextVault);
  }, []);

  const setPin = useCallback(
    (pin: string) =>
      withBusy(async () => {
        const created = await store.createVault(pin);
        await rekey(created.key, created.vault);
      }),
    [withBusy, rekey],
  );

  const removePin = useCallback(() => withBusy(() => rekey(null, null)), [withBusy, rekey]);

  const reset = useCallback(async () => {
    await store.replaceAll([], null);
    records.current = [];
    key.current = null;
    setVault(null);
    replaceSignatures([]);
    setStatus('ready');
  }, [replaceSignatures]);

  const exportBackup = useCallback(async () => {
    return new Blob([store.serializeBackup(vault, records.current)], { type: 'application/json' });
  }, [vault]);

  const backupNeedsPin = useCallback((text: string) => store.parseBackup(text).vault !== null, []);

  const importBackup = useCallback(
    (text: string, pin?: string) =>
      withBusy(async () => {
        const backup = store.parseBackup(text);
        let backupKey: CryptoKey | null = null;
        if (backup.vault) {
          backupKey = await store.unlockVault(backup.vault, pin ?? '');
          if (!backupKey) throw new WrongPinError();
        }
        const known = new Set(records.current.map((record) => record.id));
        let added = 0;
        for (const record of backup.records) {
          if (known.has(record.id)) continue;
          const data = await store.openSignature(record, backupKey);
          const sealed = await store.sealSignature(data, key.current, record.id, record.createdAt);
          await store.putSignature(sealed);
          records.current = [...records.current, sealed];
          setSignatures((current) => [...current, toSignature(sealed, data)]);
          added++;
        }
        return added;
      }),
    [withBusy],
  );

  const savePreset = useCallback(async (preset: PlacementPreset) => {
    await store.putPreset(preset as unknown as store.StoredPreset);
    setPresets((current) => [...current.filter((p) => p.id !== preset.id), preset]);
  }, []);

  const deletePreset = useCallback(async (id: string) => {
    await store.deletePreset(id);
    setPresets((current) => current.filter((preset) => preset.id !== id));
  }, []);

  const value = useMemo<SignatureLibrary>(
    () => ({
      status,
      encrypted: vault !== null,
      signatures,
      presets,
      busy,
      unlock,
      lock,
      add,
      rename,
      remove,
      setPin,
      removePin,
      reset,
      exportBackup,
      importBackup,
      backupNeedsPin,
      savePreset,
      deletePreset,
    }),
    [status, vault, signatures, presets, busy, unlock, lock, add, rename, remove, setPin, removePin, reset, exportBackup, importBackup, backupNeedsPin, savePreset, deletePreset],
  );

  return <SignatureContext.Provider value={value}>{children}</SignatureContext.Provider>;
}

export function useSignatures(): SignatureLibrary {
  const context = useContext(SignatureContext);
  if (!context) throw new Error('useSignatures must be used inside <SignatureProvider>');
  return context;
}
