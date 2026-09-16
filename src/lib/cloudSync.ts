"use client";

import { getSupabase } from "./supabaseClient";
import * as store from "./detectorStore";

/**
 * Backup and restore, deliberately — not two-way sync.
 *
 * Real sync needs conflict resolution: the same detector edited on a laptop and
 * a phone, offline, is a merge problem with no obviously right answer, and
 * guessing at one silently loses somebody's photos. Explicit "back this up" and
 * "bring this back" are honest about what they do and can't quietly destroy
 * work. If this ever grows into sync, it'll be because the data model earned
 * it, not because the buttons implied it.
 */

const BUCKET = "examples";

export interface SyncProgress {
  done: number;
  total: number;
  label: string;
}

function objectPath(userId: string, detectorLocalId: string, exampleLocalId: string): string {
  // First segment is the owner, which is what the storage policy checks.
  return `${userId}/${detectorLocalId}/${exampleLocalId}.jpg`;
}

/** Pushes one local detector and all of its photos up to the account. */
export async function backupDetector(
  detectorId: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Accounts aren't configured on this deployment.");

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to be signed in.");

  const detector = await store.getDetector(detectorId);
  if (!detector) throw new Error("That detector no longer exists locally.");
  const examples = await store.listExamples(detectorId);

  onProgress?.({ done: 0, total: examples.length + 1, label: "Saving detector…" });

  const { data: row, error } = await supabase
    .from("detectors")
    .upsert(
      {
        user_id: userId,
        local_id: detector.id,
        name: detector.name,
        preset_id: detector.presetId,
        classes: detector.classes,
        example_count: examples.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,local_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  let done = 1;
  for (const example of examples) {
    const path = objectPath(userId, detector.id, example.id);
    // upsert so re-running a backup overwrites rather than erroring on a
    // path that already exists.
    const upload = await supabase.storage
      .from(BUCKET)
      .upload(path, example.blob, { contentType: "image/jpeg", upsert: true });
    if (upload.error) throw new Error(upload.error.message);

    const { error: rowError } = await supabase.from("examples").upsert(
      {
        detector_id: row.id,
        user_id: userId,
        local_id: example.id,
        class_id: example.classId,
        storage_path: path,
        source: example.source,
      },
      { onConflict: "detector_id,local_id" },
    );
    if (rowError) throw new Error(rowError.message);

    done += 1;
    onProgress?.({ done, total: examples.length + 1, label: `Uploading photos… ${done - 1}/${examples.length}` });
  }
}

export interface CloudDetector {
  id: string;
  localId: string;
  name: string;
  exampleCount: number;
  updatedAt: string;
}

export async function listCloudDetectors(): Promise<CloudDetector[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("detectors")
    .select("id, local_id, name, example_count, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    localId: row.local_id as string,
    name: row.name as string,
    exampleCount: row.example_count as number,
    updatedAt: row.updated_at as string,
  }));
}

/** Pulls one cloud detector into IndexedDB, replacing the local copy of it. */
export async function restoreDetector(
  cloudId: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Accounts aren't configured on this deployment.");

  const { data: detectorRow, error } = await supabase
    .from("detectors")
    .select("id, local_id, name, preset_id, classes, created_at")
    .eq("id", cloudId)
    .single();
  if (error) throw new Error(error.message);

  const { data: exampleRows, error: exampleError } = await supabase
    .from("examples")
    .select("local_id, class_id, storage_path, source, created_at")
    .eq("detector_id", cloudId);
  if (exampleError) throw new Error(exampleError.message);

  const rows = exampleRows ?? [];
  const localId = detectorRow.local_id as string;

  // Clear the local copy first so a restore is a replace, not a merge that
  // leaves photos the cloud copy no longer has.
  const existing = await store.getDetector(localId);
  if (existing) {
    const stale = await store.listExamples(localId);
    await Promise.all(stale.map((e) => store.deleteExample(e.id)));
  }

  onProgress?.({ done: 0, total: rows.length, label: "Downloading photos…" });

  let done = 0;
  for (const row of rows) {
    const { data, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(row.storage_path as string);
    if (downloadError || !data) throw new Error(downloadError?.message ?? "A photo could not be downloaded.");

    await store.putExample({
      id: row.local_id as string,
      detectorId: localId,
      classId: row.class_id as string,
      blob: data,
      source: (row.source as "camera" | "upload") ?? "camera",
      createdAt: new Date(row.created_at as string).getTime(),
    });
    done += 1;
    onProgress?.({ done, total: rows.length, label: `Downloading photos… ${done}/${rows.length}` });
  }

  await store.saveDetector({
    id: localId,
    name: detectorRow.name as string,
    presetId: (detectorRow.preset_id as string | null) ?? null,
    classes: detectorRow.classes as Array<{ id: string; name: string }>,
    createdAt: new Date(detectorRow.created_at as string).getTime(),
    updatedAt: Date.now(),
    exampleCount: rows.length,
    hasModel: false,
  });

  return localId;
}

export async function deleteCloudDetector(cloudId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // Storage objects aren't removed by the row cascade, so they go first.
  const { data: rows } = await supabase
    .from("examples")
    .select("storage_path")
    .eq("detector_id", cloudId);
  const paths = (rows ?? []).map((r) => r.storage_path as string);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from("detectors").delete().eq("id", cloudId);
  if (error) throw new Error(error.message);
}
