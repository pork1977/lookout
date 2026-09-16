"use client";

/**
 * Local persistence for detectors and their photos.
 *
 * IndexedDB rather than localStorage because it stores Blobs natively — the
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
const DB_VERSION = 1;
const DETECTORS = "detectors";
const EXAMPLES = "examples";
const BY_DETECTOR = "byDetector";

export interface DetectorRecord {
  id: string;
  name: string;
  presetId: string | null;
  /** Names only — the photos live in the examples store, keyed by classId. */
  classes: Array<{ id: string; name: string }>;
  createdAt: number;
  updatedAt: number;
  /** Denormalised so the library list doesn't have to open every photo. */
  exampleCount: number;
  /** True once a model has been trained and saved for this detector. */
  hasModel?: boolean;
}

export interface ExampleRecord {
  id: string;
  detectorId: string;
  classId: string;
  blob: Blob;
  source: "camera" | "upload";
  createdAt: number;
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
      // Gone already is not an error — the photo may have been deleted while
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
  await run(DETECTORS, "readwrite", (store) => store.delete(id));
  await deleteModel(id);
}

/* ---------------------------------------------------------------- models -- */

/**
 * The trained head is saved through TensorFlow.js's own IndexedDB handler
 * rather than as a blob here — it knows how to serialise weights, and reloading
 * a saved model is what stops a refresh costing another training run.
 */
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
