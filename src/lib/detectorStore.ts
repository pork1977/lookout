"use client";

/**
 * Local persistence for detectors and their photos.
 *
 * IndexedDB rather than localStorage because it stores Blobs natively, the
 * photos stay as JPEGs instead of being base64'd into strings, which would
 * inflate them by a third and force a parse of the whole set on every read.
 *
 * Sizing: examples are already 320px JPEGs at roughly 25KB, so a hundred
 * photos is about 2.5MB against an origin quota measured in hundreds of MB.
 * Storing them is not the risk; losing them on every refresh was.
 *
 * Deliberately not a sync layer. Records are shaped so an account-backed
 * version can push the same fields later without a migration.
 */

const DB_NAME = "lookout";
const DB_VERSION = 2;
const DETECTORS = "detectors";
const EXAMPLES = "examples";
const HISTORY = "history";
const BY_DETECTOR = "byDetector";

/**
 * How many triggers are kept per detector. A detector watching all day with a
 * 60s cooldown tops out around 1,400 a day, so without a ceiling this grows
 * without bound. 300 is a few days of real use, and the oldest fall off.
 */
const HISTORY_LIMIT = 300;

export interface DetectorRecord {
  id: string;
  name: string;
  presetId: string | null;
  /** Names only, the photos live in the examples store, keyed by classId. */
  classes: Array<{ id: string; name: string }>;
  createdAt: number;
  updatedAt: number;
  /** Denormalised so the library list doesn't have to open every photo. */
  exampleCount: number;
  /** True once a model has been trained and saved for this detector. */
  hasModel?: boolean;
  /**
   * The class ids, in order, the saved model was trained on. A model only
   * makes sense against the groups it learned, so reopening checks these still
   * match before trusting it.
   */
  modelClassIds?: string[];
  modelAccuracy?: number;
  /** "When it sees it, do this". Checked on the way back in, see sanitizeTriggerSettings. */
  triggers?: unknown;
}

export interface ExampleRecord {
  id: string;
  detectorId: string;
  classId: string;
  blob: Blob;
  source: "camera" | "upload";
  createdAt: number;
}

/**
 * One thing a detector noticed. Written when a trigger fires, so that closing
 * the tab and coming back tomorrow still shows what it caught.
 *
 * Local only, like the photos. The group name is stored as it read at the
 * time rather than as an id, because renaming a group later should not
 * silently rewrite what yesterday's alert said.
 */
export interface HistoryRecord {
  id: string;
  detectorId: string;
  at: number;
  className: string;
  confidence: number;
  /** The rendered alert text, so the history says what the person was told. */
  message: string;
  /** Short camera labels, only when more than one camera was watching. */
  cameras?: string;
  /** A 160px JPEG of the moment, when a frame could be grabbed. */
  thumb?: Blob;
}

export function storageSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DETECTORS)) {
          db.createObjectStore(DETECTORS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(EXAMPLES)) {
          const store = db.createObjectStore(EXAMPLES, { keyPath: "id" });
          // Without this index, loading one detector's photos means scanning
          // every photo of every detector.
          store.createIndex(BY_DETECTOR, "detectorId", { unique: false });
        }
        // Added in version 2. Existing browsers get it on their next visit
        // without touching the detectors or photos already stored.
        if (!db.objectStoreNames.contains(HISTORY)) {
          const store = db.createObjectStore(HISTORY, { keyPath: "id" });
          store.createIndex(BY_DETECTOR, "detectorId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    }) as Promise<IDBDatabase>;
  }
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Local storage failed."));
      }),
  );
}

export async function listDetectors(): Promise<DetectorRecord[]> {
  const all = await run<DetectorRecord[]>(DETECTORS, "readonly", (store) => store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDetector(id: string): Promise<DetectorRecord | undefined> {
  return run<DetectorRecord | undefined>(DETECTORS, "readonly", (store) => store.get(id));
}

export async function saveDetector(record: DetectorRecord): Promise<void> {
  await run(DETECTORS, "readwrite", (store) => store.put(record));
}

export function listExamples(detectorId: string): Promise<ExampleRecord[]> {
  return run<ExampleRecord[]>(EXAMPLES, "readonly", (store) =>
    store.index(BY_DETECTOR).getAll(detectorId),
  );
}

export async function putExample(record: ExampleRecord): Promise<void> {
  await run(EXAMPLES, "readwrite", (store) => store.put(record));
}

export async function deleteExample(id: string): Promise<void> {
  await run(EXAMPLES, "readwrite", (store) => store.delete(id));
}

export async function moveExample(id: string, classId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(EXAMPLES, "readwrite");
    const store = tx.objectStore(EXAMPLES);
    const get = store.get(id);
    get.onsuccess = () => {
      const record = get.result as ExampleRecord | undefined;
      // Gone already is not an error, the photo may have been deleted while
      // this was queued.
      if (!record) return resolve();
      store.put({ ...record, classId });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not move that photo."));
  });
}

export async function deleteExamplesForClass(detectorId: string, classId: string): Promise<void> {
  const examples = await listExamples(detectorId);
  await Promise.all(examples.filter((e) => e.classId === classId).map((e) => deleteExample(e.id)));
}

export async function deleteDetector(id: string): Promise<void> {
  const examples = await listExamples(id);
  await Promise.all(examples.map((e) => deleteExample(e.id)));
  // Its history goes with it. Leaving orphaned entries behind would keep
  // thumbnails of a deleted detector in the browser indefinitely.
  await clearHistory(id);
  await run(DETECTORS, "readwrite", (store) => store.delete(id));
  await deleteModel(id);
}

/* ---------------------------------------------------------------- models -- */

/**
 * The trained head is saved through TensorFlow.js's own IndexedDB handler
 * rather than as a blob here, it knows how to serialise weights, and reloading
 * a saved model is what stops a refresh costing another training run.
 */
/**
 * Newest first, which is the only order anyone wants to read this in.
 * `limit` caps what comes back; the store itself is pruned on write.
 */
export async function listHistory(detectorId: string, limit = 100): Promise<HistoryRecord[]> {
  const all = await run<HistoryRecord[]>(HISTORY, "readonly", (store) =>
    store.index(BY_DETECTOR).getAll(detectorId),
  );
  return all.sort((a, b) => b.at - a.at).slice(0, limit);
}

export async function addHistory(record: HistoryRecord): Promise<void> {
  await run(HISTORY, "readwrite", (store) => store.put(record));
  await pruneHistory(record.detectorId);
}

/**
 * Drops the oldest entries past the ceiling. Done after the write rather than
 * before, so a trigger is never lost to a slow tidy-up, and failure here is
 * swallowed: an over-long history is a far smaller problem than an alert that
 * throws inside the firing path.
 */
async function pruneHistory(detectorId: string): Promise<void> {
  try {
    const all = await run<HistoryRecord[]>(HISTORY, "readonly", (store) =>
      store.index(BY_DETECTOR).getAll(detectorId),
    );
    if (all.length <= HISTORY_LIMIT) return;
    const doomed = all.sort((a, b) => b.at - a.at).slice(HISTORY_LIMIT);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY, "readwrite");
      const store = tx.objectStore(HISTORY);
      doomed.forEach((item) => store.delete(item.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not tidy the history."));
    });
  } catch {
    /* an over-long history is not worth surfacing to anyone */
  }
}

export async function clearHistory(detectorId: string): Promise<void> {
  const all = await run<HistoryRecord[]>(HISTORY, "readonly", (store) =>
    store.index(BY_DETECTOR).getAll(detectorId),
  );
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY, "readwrite");
    const store = tx.objectStore(HISTORY);
    all.forEach((item) => store.delete(item.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear the history."));
  });
}

export function modelUrl(detectorId: string): string {
  return `indexeddb://lookout-head-${detectorId}`;
}

export async function deleteModel(detectorId: string): Promise<void> {
  try {
    const tf = await import("@tensorflow/tfjs");
    await tf.io.removeModel(modelUrl(detectorId));
  } catch {
    // No saved model for this detector, which is the common case.
  }
}

export async function hasSavedModel(detectorId: string): Promise<boolean> {
  try {
    const tf = await import("@tensorflow/tfjs");
    const models = await tf.io.listModels();
    return Object.keys(models).includes(modelUrl(detectorId));
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- usage -- */

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
}

export async function estimateUsage(): Promise<StorageUsage | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  if (usage === undefined || quota === undefined) return null;
  return { usedBytes: usage, quotaBytes: quota };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
