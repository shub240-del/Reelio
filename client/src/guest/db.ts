/**
 * IndexedDB store backing Guest Mode.
 *
 * Reelio has to be usable with no account and no server: the editor is the
 * product, and a login wall in front of it is a dead end. This is the whole
 * persistence layer for that mode - projects, assets, clips and the media bytes
 * themselves all live in the browser, so a guest can import footage, edit, close
 * the tab and come back to the same timeline.
 *
 * Media is stored as Blobs rather than base64. Base64 inflates bytes by a third
 * and a single 100MB clip would blow past what a string can comfortably hold;
 * Blobs also hand us object URLs that <video> can play directly.
 */

const DB_NAME = "reelio-guest";
const DB_VERSION = 1;

export type StoreName = "projects" | "assets" | "clips" | "blobs" | "meta";

const STORES: { name: StoreName; keyPath: string; autoIncrement: boolean; indexes?: string[] }[] = [
  { name: "projects", keyPath: "id", autoIncrement: true },
  { name: "assets", keyPath: "id", autoIncrement: true, indexes: ["projectId"] },
  { name: "clips", keyPath: "id", autoIncrement: true, indexes: ["projectId", "assetId"] },
  // Media bytes, keyed by storageKey so an asset row stays small and cloneable.
  { name: "blobs", keyPath: "key", autoIncrement: false },
  { name: "meta", keyPath: "key", autoIncrement: false },
];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openGuestDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (db.objectStoreNames.contains(store.name)) continue;
        const os = db.createObjectStore(store.name, {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
        });
        for (const idx of store.indexes ?? []) os.createIndex(idx, idx, { unique: false });
      }
    };
    req.onsuccess = () => {
      // If another tab upgrades the schema, close so it is not blocked.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
  return dbPromise;
}

/** Promisified request, so callers can use async/await instead of callbacks. */
function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openGuestDb();
  return db.transaction(store, mode).objectStore(store);
}

export async function put<T>(store: StoreName, value: T): Promise<T> {
  const os = await tx(store, "readwrite");
  const key = await wrap(os.put(value as unknown as IDBValidKey extends never ? never : any));
  // Autoincrement stores assign the id on write; reflect it back to the caller.
  const withId = value as Record<string, unknown>;
  if (withId && withId.id === undefined && typeof key === "number") withId.id = key;
  return value;
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const os = await tx(store, "readonly");
  return (await wrap(os.get(key))) as T | undefined;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const os = await tx(store, "readonly");
  return (await wrap(os.getAll())) as T[];
}

/** All rows whose indexed field equals `value` (e.g. every clip in a project). */
export async function getAllBy<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const os = await tx(store, "readonly");
  if (!os.indexNames.contains(index)) {
    const all = (await wrap(os.getAll())) as T[];
    return all.filter((row) => (row as Record<string, unknown>)[index] === value);
  }
  return (await wrap(os.index(index).getAll(value))) as T[];
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const os = await tx(store, "readwrite");
  await wrap(os.delete(key));
}

/** Deletes every row in `store` whose indexed field matches - our cascade. */
export async function delAllBy(store: StoreName, index: string, value: IDBValidKey): Promise<number> {
  const rows = await getAllBy<{ id: number }>(store, index, value);
  for (const row of rows) await del(store, row.id);
  return rows.length;
}

export async function clearGuestData(): Promise<void> {
  const db = await openGuestDb();
  const names = [...db.objectStoreNames] as StoreName[];
  const t = db.transaction(names, "readwrite");
  for (const n of names) t.objectStore(n).clear();
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Apply a complete guest timeline commit in one IndexedDB transaction. */
export async function commitGuestClipBatch<T extends { id: number; projectId: number }>(
  projectId: number,
  input: {
    creates: Array<Omit<T, "id" | "projectId"> & { id?: number }>;
    updates: Array<{ id: number; patch: Partial<T> }>;
    deletes: number[];
  },
): Promise<T[]> {
  const db = await openGuestDb();
  const transaction = db.transaction("clips", "readwrite");
  const store = transaction.objectStore("clips");
  const current = (await wrap(store.index("projectId").getAll(projectId))) as T[];
  const byId = new Map(current.map((clip) => [clip.id, clip]));

  const complete = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Timeline commit failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Timeline commit was aborted"));
  });

  const requests: Promise<unknown>[] = [];
  for (const id of input.deletes) {
    if (!byId.has(id)) throw new Error("Timeline commit referenced an unknown clip");
    requests.push(wrap(store.delete(id)));
  }
  for (const update of input.updates) {
    const clip = byId.get(update.id);
    if (!clip) throw new Error("Timeline commit referenced an unknown clip");
    requests.push(wrap(store.put({ ...clip, ...update.patch, id: clip.id, projectId })));
  }
  for (const create of input.creates) {
    const row = { ...create, projectId } as Record<string, unknown>;
    const request = wrap(store.put(row as any)).then((key) => {
      if (row.id === undefined && typeof key === "number") row.id = key;
    });
    requests.push(request);
  }

  await Promise.all(requests);
  await complete;
  return getAllBy<T>("clips", "projectId", projectId);
}

/* ────────────────────────── media blobs ────────────────────────── */

const urlCache = new Map<string, string>();

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await put("blobs", { key, blob, size: blob.size, type: blob.type });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const row = await get<{ key: string; blob: Blob }>("blobs", key);
  return row?.blob;
}

/**
 * Stable object URL for stored media.
 *
 * Cached because a fresh createObjectURL on every render would leak a URL per
 * paint, and because <video> reloads whenever its src identity changes - which
 * would restart playback on each re-render.
 */
export async function blobUrl(key: string): Promise<string | null> {
  const cached = urlCache.get(key);
  if (cached) return cached;
  const blob = await getBlob(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function revokeBlobUrl(key: string): void {
  const url = urlCache.get(key);
  if (!url) return;
  URL.revokeObjectURL(url);
  urlCache.delete(key);
}

/** Bytes used by stored media, so the UI can warn before the quota bites. */
export async function guestStorageUsage(): Promise<{ bytes: number; quota: number | null }> {
  const blobs = await getAll<{ size?: number }>("blobs");
  const bytes = blobs.reduce((sum, b) => sum + (b.size ?? 0), 0);
  let quota: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null;
  } catch {
    quota = null;
  }
  return { bytes, quota };
}
