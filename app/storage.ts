const DATABASE_NAME = "wireform-local-data";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const FALLBACK_PREFIX = "wireform:";

export const AUTOSAVE_KEY = "project-autosave";
export const LIBRARIES_KEY = "user-libraries";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed."));
  });
}

async function indexedDbGet<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB read failed."));
    });
  } finally {
    database.close();
  }
}

async function indexedDbSet<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB write failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function readLocalDocument<T>(key: string): Promise<T | undefined> {
  // A fallback written after an IndexedDB failure is newer than the old DB
  // record. The marker contains no project data and is removed on a good save.
  let currentFallback: string | null = null;
  try {
    if (localStorage.getItem(`${FALLBACK_PREFIX}${key}:fallback-current`) === "1") {
      currentFallback = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    }
  } catch { /* IndexedDB remains usable when localStorage is blocked. */ }
  if (currentFallback !== null) return JSON.parse(currentFallback) as T;
  let databaseError: unknown;
  try {
    const document = await indexedDbGet<T>(key);
    if (document !== undefined) return document;
  } catch (error) { databaseError = error; }
  try {
    const value = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    if (value) return JSON.parse(value) as T;
  } catch (error) {
    throw databaseError ?? error;
  }
  // A failed read is not an empty store: callers must not overwrite a project
  // they could not recover, especially one containing embedded reference files.
  if (databaseError) throw databaseError;
  return undefined;
}

const pendingWrites = new Map<string, Promise<void>>();

export async function writeLocalDocument<T>(
  key: string,
  value: T,
  options: { indexedDbOnly?: boolean } = {},
): Promise<void> {
  // Serialize writes so an older autosave can never finish over a newer one.
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    try {
      await indexedDbSet(key, value);
      // Avoid keeping a second Base64 copy or stale fallback after a good save.
      try {
        localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
        localStorage.removeItem(`${FALLBACK_PREFIX}${key}:fallback-current`);
      } catch { /* Optional cleanup. */ }
    } catch (error) {
      if (options.indexedDbOnly) throw error;
      localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
      localStorage.setItem(`${FALLBACK_PREFIX}${key}:fallback-current`, "1");
    }
  });
  pendingWrites.set(key, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }
}
