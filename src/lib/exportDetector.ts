import { strToU8, zipSync, type Zippable } from "fflate";
import type * as tfTypes from "@tensorflow/tfjs";
import { exportHtml, exportReadme } from "./exportTemplates";
import type { TriggerSettings } from "./triggerSettings";

/**
 * "Export": everything a developer needs to run a Lookout detector outside
 * Lookout, as one zip.
 *
 *   <folder>/
 *     index.html              open it and it runs
 *     README.md               what's here and how to use it
 *     metadata.json           labels, the feature model to pair with, input rules
 *     model/model.json        the trained classifier (TensorFlow.js layers format)
 *     model/weights.bin
 *     model/detector-data.js  the same data as a script, see below
 *     photos/<group>/001.jpg  the training photos, one folder per group
 *
 * Why detector-data.js exists: browsers refuse fetch() from a page opened as a
 * file:// URL, so an index.html double-clicked out of a zip can't read
 * metadata.json or model.json. A <script src> is still allowed, so the same
 * data ships as a script too, and index.html uses whichever works. Served over
 * http it reads the JSON files like any real app would.
 *
 * The weights are exported at full precision. The 8-bit packing used for
 * share links is a storage trade-off that makes no sense in a download.
 */

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportGroup {
  id: string;
  name: string;
  photos: Array<{ bytes: Uint8Array; source: "camera" | "upload" }>;
}

export interface ExportInput {
  name: string;
  groups: ExportGroup[];
  artifacts: tfTypes.io.ModelArtifacts;
  weights: Uint8Array;
  finalAccuracy: number;
  settings: TriggerSettings;
  exportedAt: Date;
}

export interface ExportMetadata {
  format: "lookout-detector";
  formatVersion: number;
  name: string;
  exportedAt: string;
  labels: string[];
  groupIds: string[];
  trainingAccuracy: number;
  featureModel: {
    package: "@tensorflow-models/mobilenet";
    packageVersion: string;
    version: 2;
    alpha: 1;
    output: "1280-number embedding from mobilenet.infer(image, true)";
  };
  runtime: { package: "@tensorflow/tfjs"; packageVersion: string };
  input: {
    size: number;
    crop: "centre-square";
    mirrorWebcam: boolean;
    note: string;
  };
  trigger: {
    watchLabel: string;
    threshold: number;
    releaseThreshold: number;
    dwellSeconds: number;
    cooldownSeconds: number;
  };
  photos: Record<string, { folder: string; count: number; fromCamera: number; uploaded: number }>;
}

/** A folder name that is safe on Windows, macOS and Linux, and unique within the export. */
export function safeName(raw: string, fallback: string, taken: Set<string>): string {
  const cleaned =
    raw
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9 _-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || fallback;
  let name = cleaned;
  for (let n = 2; taken.has(name); n++) name = `${cleaned}-${n}`;
  taken.add(name);
  return name;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Builds the zip's files. Pure, so it can be checked outside a browser. */
export function buildExportFiles(input: ExportInput): { folder: string; files: Record<string, Uint8Array> } {
  const folder = safeName(input.name, "lookout-detector", new Set());
  const labels = input.groups.map((g, i) => g.name.trim() || `Group ${i + 1}`);
  const watchIndex = Math.max(0, input.groups.findIndex((g) => g.id === input.settings.rule.classId));

  const modelJson = {
    format: "layers-model",
    generatedBy: "Lookout",
    convertedBy: null,
    modelTopology: input.artifacts.modelTopology,
    weightsManifest: [{ paths: ["weights.bin"], weights: input.artifacts.weightSpecs }],
  };

  const taken = new Set<string>();
  const photoFiles: Record<string, Uint8Array> = {};
  const photos: ExportMetadata["photos"] = {};
  input.groups.forEach((group, i) => {
    const groupFolder = safeName(labels[i], `group-${i + 1}`, taken);
    group.photos.forEach((photo, n) => {
      photoFiles[`photos/${groupFolder}/${String(n + 1).padStart(3, "0")}.jpg`] = photo.bytes;
    });
    photos[labels[i]] = {
      folder: `photos/${groupFolder}`,
      count: group.photos.length,
      fromCamera: group.photos.filter((p) => p.source === "camera").length,
      uploaded: group.photos.filter((p) => p.source === "upload").length,
    };
  });

  const metadata: ExportMetadata = {
    format: "lookout-detector",
    formatVersion: EXPORT_FORMAT_VERSION,
    name: input.name.trim() || "Untitled detector",
    exportedAt: input.exportedAt.toISOString(),
    labels,
    groupIds: input.groups.map((g) => g.id),
    trainingAccuracy: Math.round(input.finalAccuracy * 1000) / 1000,
    featureModel: {
      package: "@tensorflow-models/mobilenet",
      packageVersion: "2.1.1",
      version: 2,
      alpha: 1,
      output: "1280-number embedding from mobilenet.infer(image, true)",
    },
    runtime: { package: "@tensorflow/tfjs", packageVersion: "4.22.0" },
    input: {
      size: 320,
      crop: "centre-square",
      mirrorWebcam: true,
      note:
        "Images are centre-cropped to a square and scaled to 320px before the feature model. Webcam photos were stored mirrored (selfie view), so mirror live webcam frames the same way. Uploaded photos were not mirrored.",
    },
    trigger: {
      watchLabel: labels[watchIndex],
      threshold: input.settings.rule.threshold,
      releaseThreshold: input.settings.rule.releaseThreshold,
      dwellSeconds: input.settings.rule.dwellSeconds,
      cooldownSeconds: input.settings.rule.cooldownSeconds,
    },
    photos,
  };

  const dataScript =
    "// The same data as metadata.json and model/, as a script. index.html uses this\n" +
    "// when it is opened straight from disk (file://), where browsers block fetch().\n" +
    `window.LOOKOUT_DETECTOR = ${JSON.stringify({
      metadata,
      model: modelJson,
      weightsBase64: toBase64(input.weights),
    })};\n`;

  return {
    folder,
    files: {
      "index.html": strToU8(exportHtml(metadata)),
      "README.md": strToU8(exportReadme(metadata)),
      "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
      "model/model.json": strToU8(JSON.stringify(modelJson)),
      "model/weights.bin": input.weights,
      "model/detector-data.js": strToU8(dataScript),
      ...photoFiles,
    },
  };
}

/** Zips the files under one top-level folder, so extracting never scatters them. */
export function zipExport(folder: string, files: Record<string, Uint8Array>): Uint8Array {
  const tree: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) {
    // JPEGs are already compressed; deflating them again only costs time.
    tree[`${folder}/${path}`] = path.endsWith(".jpg") ? [bytes, { level: 0 }] : bytes;
  }
  return zipSync(tree, { level: 6 });
}

/** Browser side: reads the trained head, gathers the photos, zips and downloads. */
export async function downloadDetectorExport(input: {
  name: string;
  groups: Array<{ id: string; name: string; examples: Array<{ blob: Blob; source: "camera" | "upload" }> }>;
  head: { model: tfTypes.LayersModel; finalAccuracy: number };
  settings: TriggerSettings;
}): Promise<{ fileName: string; bytes: number }> {
  const tf = await import("@tensorflow/tfjs");
  let captured: tfTypes.io.ModelArtifacts | null = null;
  await input.head.model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      captured = artifacts;
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    }),
  );
  const artifacts = captured as tfTypes.io.ModelArtifacts | null;
  if (!artifacts?.weightData || !artifacts.weightSpecs) throw new Error("Couldn't read the trained model.");

  const groups: ExportGroup[] = await Promise.all(
    input.groups.map(async (group) => ({
      id: group.id,
      name: group.name,
      photos: await Promise.all(
        group.examples.map(async (example) => ({
          bytes: new Uint8Array(await example.blob.arrayBuffer()),
          source: example.source,
        })),
      ),
    })),
  );

  const { folder, files } = buildExportFiles({
    name: input.name,
    groups,
    artifacts,
    weights: new Uint8Array(tf.io.CompositeArrayBuffer.join(artifacts.weightData)),
    finalAccuracy: input.head.finalAccuracy,
    settings: input.settings,
    exportedAt: new Date(),
  });
  const zipped = zipExport(folder, files);

  const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folder}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later rather than immediately: some browsers start the download
  // asynchronously and would find the URL already gone.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { fileName: `${folder}.zip`, bytes: zipped.length };
}
