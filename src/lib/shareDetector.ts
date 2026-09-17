"use client";

import type * as tfTypes from "@tensorflow/tfjs";
import { getSupabase } from "./supabaseClient";
import type { TrainedHead } from "./trainer";
import { sanitizeTriggerSettings, type TriggerSettings } from "./triggerSettings";

/**
 * Shareable run links.
 *
 * A share is the trained head plus names and settings, nothing else, and
 * certainly no photos. Weights are stored at 8 bits per number with a
 * per-tensor range, which takes a head from about 690KB of base64 to about
 * 170KB. Checked against the full-precision head: probabilities move by under
 * 1%, and the top answer is the same on 199 of 200 random inputs, the one
 * miss being a near tie.
 */

export interface SharedGroup {
  id: string;
  name: string;
}

interface Quantization {
  min: number;
  scale: number;
}

interface PackedHead {
  model_topology: unknown;
  weight_specs: tfTypes.io.WeightsManifestEntry[];
  quantization: Quantization[];
  weights: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sizeOf(spec: tfTypes.io.WeightsManifestEntry): number {
  return spec.shape.reduce((n, d) => n * d, 1);
}

async function packHead(head: TrainedHead): Promise<PackedHead> {
  const tf = await import("@tensorflow/tfjs");
  let artifacts: tfTypes.io.ModelArtifacts | null = null;
  await head.model.save(
    tf.io.withSaveHandler(async (captured) => {
      artifacts = captured;
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    }),
  );
  const saved = artifacts as tfTypes.io.ModelArtifacts | null;
  if (!saved?.weightData || !saved.weightSpecs) throw new Error("Couldn't read the trained model.");
  if (saved.weightSpecs.some((spec) => spec.dtype !== "float32")) {
    throw new Error("This model has weights that can't be shared yet.");
  }

  const floats = new Float32Array(tf.io.CompositeArrayBuffer.join(saved.weightData));
  const bytes = new Uint8Array(floats.length);
  const quantization: Quantization[] = [];
  let offset = 0;
  for (const spec of saved.weightSpecs) {
    const end = offset + sizeOf(spec);
    let min = Infinity;
    let max = -Infinity;
    for (let i = offset; i < end; i++) {
      if (floats[i] < min) min = floats[i];
      if (floats[i] > max) max = floats[i];
    }
    const scale = (max - min) / 255 || 1;
    quantization.push({ min, scale });
    for (let i = offset; i < end; i++) bytes[i] = Math.round((floats[i] - min) / scale);
    offset = end;
  }

  return {
    model_topology: saved.modelTopology,
    weight_specs: saved.weightSpecs,
    quantization,
    weights: toBase64(bytes),
  };
}

async function unpackHead(packed: PackedHead, classIds: string[]): Promise<TrainedHead> {
  const tf = await import("@tensorflow/tfjs");
  const bytes = fromBase64(packed.weights);
  const specs = packed.weight_specs;
  const expected = specs.reduce((n, spec) => n + sizeOf(spec), 0);
  if (bytes.length !== expected || packed.quantization.length !== specs.length) {
    throw new Error("This shared detector is damaged.");
  }

  const floats = new Float32Array(bytes.length);
  let offset = 0;
  specs.forEach((spec, k) => {
    const { min, scale } = packed.quantization[k];
    const end = offset + sizeOf(spec);
    for (let i = offset; i < end; i++) floats[i] = min + bytes[i] * scale;
    offset = end;
  });

  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: packed.model_topology as tfTypes.io.ModelArtifacts["modelTopology"],
      weightSpecs: specs,
      weightData: floats.buffer,
    }),
  );
  const outputs = model.outputs[0]?.shape?.[1];
  if (outputs !== classIds.length) {
    model.dispose();
    throw new Error("This shared detector doesn't match its own groups.");
  }
  return { model, classIds, finalAccuracy: 0 };
}

export interface ShareStatus {
  slug: string;
  updatedAt: string;
}

export function shareUrl(slug: string): string {
  return `${window.location.origin}/run/${slug}`;
}

/** The current share for one local detector, if this account has one. */
export async function getMyShare(localId: string): Promise<ShareStatus | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shared_detectors")
    .select("slug, updated_at")
    .eq("local_id", localId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { slug: data.slug as string, updatedAt: data.updated_at as string } : null;
}

/** Creates the link, or refreshes it with the current model and settings. Same link either way. */
export async function publishShare(input: {
  localId: string;
  name: string;
  groups: SharedGroup[];
  head: TrainedHead;
  settings: TriggerSettings;
}): Promise<ShareStatus> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Accounts aren't configured on this deployment.");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("You need to be signed in to share.");

  const packed = await packHead(input.head);
  // Only what the run page needs. Voice choice is per device, so it stays behind.
  const settings: TriggerSettings = {
    ...input.settings,
    speech: { rate: input.settings.speech.rate, pitch: input.settings.speech.pitch },
  };

  const { data, error } = await supabase
    .from("shared_detectors")
    .upsert(
      {
        user_id: auth.user.id,
        local_id: input.localId,
        name: input.name.slice(0, 300),
        classes: input.groups.map((g) => ({ id: g.id, name: g.name })),
        settings,
        ...packed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,local_id" },
    )
    .select("slug, updated_at")
    .single();
  if (error) {
    throw new Error(
      error.message.includes("share limit")
        ? "You've reached the limit of 25 shared detectors. Stop sharing one to share another."
        : error.message,
    );
  }
  return { slug: data.slug as string, updatedAt: data.updated_at as string };
}

export async function unpublishShare(localId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("shared_detectors").delete().eq("local_id", localId);
  if (error) throw new Error(error.message);
}

export interface SharedDetector {
  name: string;
  groups: SharedGroup[];
  settings: TriggerSettings;
  head: TrainedHead;
}

/** Loads a share by its public slug. Works signed out. */
export async function loadSharedDetector(slug: string): Promise<SharedDetector | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Shared detectors aren't available on this deployment.");
  if (!/^[0-9a-f]{24}$/.test(slug)) return null;

  const { data, error } = await supabase.rpc("get_shared_detector", { p_slug: slug });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  const groups: SharedGroup[] = Array.isArray(row.classes)
    ? (row.classes as unknown[])
        .filter((g): g is SharedGroup => !!g && typeof (g as SharedGroup).id === "string")
        .map((g) => ({ id: g.id, name: typeof g.name === "string" ? g.name.slice(0, 200) : "" }))
    : [];
  if (groups.length < 2) throw new Error("This shared detector is damaged.");

  const classIds = groups.map((g) => g.id);
  const head = await unpackHead(row as PackedHead, classIds);
  return {
    name: typeof row.name === "string" ? row.name : "",
    groups,
    settings: sanitizeTriggerSettings(row.settings, classIds),
    head,
  };
}
