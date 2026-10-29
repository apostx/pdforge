// Signatures live in IndexedDB on this device only. With a PIN set, each signature is
// encrypted with AES-GCM under a key derived from the PIN (PBKDF2-SHA-256), and the key
// is only ever held in memory. Without a PIN they are stored as-is.

export interface SignatureData {
  name: string;
  /** PNG with a transparent background. */
  png: Uint8Array;
  width: number;
  height: number;
}

/** What is written to the database: the encoded SignatureData, encrypted when `iv` is set. */
export interface StoredSignature {
  id: string;
  createdAt: number;
  iv: Uint8Array | null;
  payload: Uint8Array;
}

/** Present only when a PIN is set. */
export interface Vault {
  salt: Uint8Array;
  iterations: number;
  /** A known value encrypted with the key, used to check a PIN. */
  verifierIv: Uint8Array;
  verifier: Uint8Array;
}

export interface StoredPreset {
  id: string;
  [key: string]: unknown;
}

const DB_NAME = 'pdforge';
const SIGNATURES = 'signatures';
const PRESETS = 'presets';
const META = 'meta';
const VAULT_KEY = 'vault';

// OWASP's recommendation for PBKDF2-HMAC-SHA256 (2023).
const ITERATIONS = 600_000;
const VERIFIER = new TextEncoder().encode('pdforge-vault-v1');

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(SIGNATURES, { keyPath: 'id' });
      db.createObjectStore(PRESETS, { keyPath: 'id' });
      db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadAll(): Promise<{ vault: Vault | null; signatures: StoredSignature[]; presets: StoredPreset[] }> {
  const db = await openDatabase();
  const transaction = db.transaction([SIGNATURES, PRESETS, META]);
  const [vault, signatures, presets] = await Promise.all([
    done(transaction.objectStore(META).get(VAULT_KEY)) as Promise<Vault | undefined>,
    done(transaction.objectStore(SIGNATURES).getAll()) as Promise<StoredSignature[]>,
    done(transaction.objectStore(PRESETS).getAll()) as Promise<StoredPreset[]>,
  ]);
  return { vault: vault ?? null, signatures: signatures.sort((a, b) => a.createdAt - b.createdAt), presets };
}

export async function putSignature(record: StoredSignature): Promise<void> {
  const transaction = (await openDatabase()).transaction(SIGNATURES, 'readwrite');
  transaction.objectStore(SIGNATURES).put(record);
  await committed(transaction);
}

export async function deleteSignature(id: string): Promise<void> {
  const transaction = (await openDatabase()).transaction(SIGNATURES, 'readwrite');
  transaction.objectStore(SIGNATURES).delete(id);
  await committed(transaction);
}

/** Replaces every signature and the vault in one transaction (setting, changing or removing the PIN). */
export async function replaceAll(records: StoredSignature[], vault: Vault | null): Promise<void> {
  const transaction = (await openDatabase()).transaction([SIGNATURES, META], 'readwrite');
  const signatures = transaction.objectStore(SIGNATURES);
  signatures.clear();
  for (const record of records) signatures.put(record);
  if (vault) transaction.objectStore(META).put(vault, VAULT_KEY);
  else transaction.objectStore(META).delete(VAULT_KEY);
  await committed(transaction);
}

export async function putPreset(preset: StoredPreset): Promise<void> {
  const transaction = (await openDatabase()).transaction(PRESETS, 'readwrite');
  transaction.objectStore(PRESETS).put(preset);
  await committed(transaction);
}

export async function deletePreset(id: string): Promise<void> {
  const transaction = (await openDatabase()).transaction(PRESETS, 'readwrite');
  transaction.objectStore(PRESETS).delete(id);
  await committed(transaction);
}

// ---------- Encryption ----------

export async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // the key can't be read back out, even by our own code
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(key: CryptoKey, plain: Uint8Array): Promise<{ iv: Uint8Array; data: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
  return { iv, data };
}

async function decrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
}

/** Creates a vault (new random salt) for a PIN. */
export async function createVault(pin: string): Promise<{ vault: Vault; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt, ITERATIONS);
  const { iv, data } = await encrypt(key, VERIFIER);
  return { vault: { salt, iterations: ITERATIONS, verifierIv: iv, verifier: data }, key };
}

/** The key for `pin`, or null if the PIN is wrong. */
export async function unlockVault(vault: Vault, pin: string): Promise<CryptoKey | null> {
  const key = await deriveKey(pin, vault.salt, vault.iterations);
  try {
    await decrypt(key, vault.verifierIv, vault.verifier);
    return key;
  } catch {
    return null; // AES-GCM authentication failed
  }
}

// ---------- Records ----------

function encodeSignature({ name, png, width, height }: SignatureData): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ name, width, height }));
  const out = new Uint8Array(4 + header.length + png.length);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  out.set(png, 4 + header.length);
  return out;
}

function decodeSignature(bytes: Uint8Array): SignatureData {
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  return { ...header, png: bytes.slice(4 + headerLength) };
}

export async function sealSignature(
  data: SignatureData,
  key: CryptoKey | null,
  id: string,
  createdAt: number,
): Promise<StoredSignature> {
  const encoded = encodeSignature(data);
  if (!key) return { id, createdAt, iv: null, payload: encoded };
  const { iv, data: payload } = await encrypt(key, encoded);
  return { id, createdAt, iv, payload };
}

export async function openSignature(record: StoredSignature, key: CryptoKey | null): Promise<SignatureData> {
  if (!record.iv) return decodeSignature(record.payload);
  if (!key) throw new Error('Signature is encrypted');
  return decodeSignature(await decrypt(key, record.iv, record.payload));
}

// ---------- Backup files ----------

const BACKUP_FORMAT = 'pdforge-signatures';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** A backup holds the records exactly as stored, so an encrypted library stays encrypted in the file. */
export function serializeBackup(vault: Vault | null, records: StoredSignature[]): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    vault: vault && {
      salt: toBase64(vault.salt),
      iterations: vault.iterations,
      verifierIv: toBase64(vault.verifierIv),
      verifier: toBase64(vault.verifier),
    },
    signatures: records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      iv: record.iv && toBase64(record.iv),
      payload: toBase64(record.payload),
    })),
  });
}

export class InvalidBackupError extends Error {}

export function parseBackup(text: string): { vault: Vault | null; records: StoredSignature[] } {
  try {
    const backup = JSON.parse(text);
    if (backup.format !== BACKUP_FORMAT || backup.version !== 1) throw new Error('not a backup');
    return {
      vault: backup.vault && {
        salt: fromBase64(backup.vault.salt),
        iterations: backup.vault.iterations,
        verifierIv: fromBase64(backup.vault.verifierIv),
        verifier: fromBase64(backup.vault.verifier),
      },
      records: backup.signatures.map((record: { id: string; createdAt: number; iv: string | null; payload: string }) => ({
        id: String(record.id),
        createdAt: Number(record.createdAt),
        iv: record.iv ? fromBase64(record.iv) : null,
        payload: fromBase64(record.payload),
      })),
    };
  } catch {
    throw new InvalidBackupError();
  }
}
