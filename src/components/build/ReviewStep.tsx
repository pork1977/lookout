"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AGREEMENT_CONFIDENCE,
  MAX_IMAGES_PER_RUN,
  batchImages,
  type LabelAvailability,
  type LabelRequestImage,
  type LabelResult,
} from "@/lib/labeling";
import type { DetectorClass, ExampleImage } from "./types";

type RunState = "idle" | "running" | "done" | "error";

interface Verdict extends LabelResult {
  classId: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: spreading a 30KB array into String.fromCharCode is fine, but this
  // stays safe if example images ever get larger.
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export default function ReviewStep({
  description,
  classes,
  onMoveExample,
  onDeleteExample,
  onBack,
  onContinue,
}: {
  description: string;
  classes: DetectorClass[];
  onMoveExample: (fromClassId: string, exampleId: string, toClassId: string) => void;
  onDeleteExample: (classId: string, exampleId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [availability, setAvailability] = useState<LabelAvailability | null>(null);
  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/label")
      .then((r) => r.json())
      .then((data: LabelAvailability) => {
        if (!cancelled) setAvailability(data);
      })
      .catch(() => {
        if (!cancelled) setAvailability({ available: false, model: "", maxImagesPerRequest: 0, maxImagesPerRun: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    setState("running");
    setError(null);
    setVerdicts({});
    setResolved(new Set());

    const all: Array<{ example: ExampleImage; classId: string }> = classes.flatMap((c) =>
      c.examples.map((example) => ({ example, classId: c.id })),
    );
    const selected = all.slice(0, MAX_IMAGES_PER_RUN);
    setSkipped(all.length - selected.length);

    const batches = batchImages(selected);
    setProgress({ done: 0, total: selected.length });

    const collected: Record<string, Verdict> = {};
    let failures = 0;

    for (const batch of batches) {
      const images: LabelRequestImage[] = await Promise.all(
        batch.map(async ({ example, classId }) => ({
          id: example.id,
          classId,
          data: await blobToBase64(example.blob),
          mediaType: example.blob.type || "image/jpeg",
        })),
      );

      try {
        const response = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            classes: classes.map((c) => ({ id: c.id, name: c.name })),
            images,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "Labelling failed.");

        for (const result of payload.results as LabelResult[]) {
          const source = batch.find((b) => b.example.id === result.id);
          if (source) collected[result.id] = { ...result, classId: source.classId };
        }
      } catch (err) {
        // A rejected batch is left unchecked rather than partly applied — the
        // route refuses any response it can't line up with the images it sent.
        failures += batch.length;
        if (!Object.keys(collected).length && batches.length === 1) {
          setError(err instanceof Error ? err.message : "Labelling failed.");
          setState("error");
          return;
        }
      }

      setProgress((p) => ({ ...p, done: p.done + batch.length }));
      setVerdicts({ ...collected });
    }

    if (failures > 0) {
      setError(`${failures} photo${failures === 1 ? "" : "s"} couldn't be checked and were left as they are.`);
    }
    setState("done");
  }, [classes, description]);

  const nameOf = useCallback(
    (id: string | null) => classes.find((c) => c.id === id)?.name || "Untitled group",
    [classes],
  );
  const exampleOf = useCallback(
    (verdict: Verdict) =>
      classes.find((c) => c.id === verdict.classId)?.examples.find((e) => e.id === verdict.id),
    [classes],
  );

  const all = Object.values(verdicts);
  const confirmed = all.filter(
    (v) => v.suggestedClassId === v.classId && v.confidence >= AGREEMENT_CONFIDENCE,
  );
  const queue = all.filter(
    (v) =>
      !(v.suggestedClassId === v.classId && v.confidence >= AGREEMENT_CONFIDENCE) &&
      !resolved.has(v.id),
  );

  function resolve(id: string) {
    setResolved((prev) => new Set(prev).add(id));
  }

  if (!availability) {
    return <p className="text-sm text-muted">Checking whether AI labelling is available…</p>;
  }

  if (!availability.available) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">AI labelling is switched off</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            This step asks Claude to look at each photo and say which group it belongs in, so you
            only review the ones it isn&apos;t sure about. It needs an{" "}
            <code className="rounded bg-surface-raised px-1.5 py-0.5 text-xs">ANTHROPIC_API_KEY</code>{" "}
            set on the server, and this deployment doesn&apos;t have one.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Nothing else is blocked — your photos are already sorted into the groups you put them
            in, which is all training needs.
          </p>
        </div>
        <Footer onBack={onBack} onContinue={onContinue} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {state === "idle" && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Let Claude check your photos</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Claude looks at each photo and says which group it thinks it belongs in. Where it
            agrees with you and is confident, nothing changes. You only review the rest — the
            blurry ones, the empty frames, and the ones that ended up in the wrong group.
          </p>
          <button
            onClick={run}
            className="mt-5 rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Check my photos
          </button>
          <p className="mt-3 text-xs text-muted">
            Photos are sent to Anthropic for this step only, and aren&apos;t stored. Up to{" "}
            {MAX_IMAGES_PER_RUN} photos per run.
          </p>
        </div>
      )}

      {state === "running" && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-foreground">
            Checking {progress.done} of {progress.total}…
          </p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                background: "linear-gradient(90deg, var(--accent), var(--accent-strong))",
              }}
            />
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-foreground">{error}</p>
          <button
            onClick={run}
            className="mt-4 rounded-full border border-border-strong px-5 py-2 text-xs font-medium hover:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      )}

      {state === "done" && (
        <>
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold text-foreground">
              {/* "Confirmed" means nothing moved — saying "labelled" here would
                  imply Claude changed something. */}
              {confirmed.length} photo{confirmed.length === 1 ? "" : "s"} confirmed where you put
              {confirmed.length === 1 ? " it" : " them"}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {queue.length > 0
                ? `${queue.length} still worth a look.`
                : "Nothing left to review."}
            </p>
            {skipped > 0 && (
              <p className="mt-2 text-xs text-muted">
                {skipped} photo{skipped === 1 ? "" : "s"} beyond the {MAX_IMAGES_PER_RUN}-per-run
                limit weren&apos;t checked.
              </p>
            )}
            {error && <p className="mt-2 text-xs text-muted">{error}</p>}
          </div>

          {queue.map((verdict) => {
            const example = exampleOf(verdict);
            if (!example) return null;
            const disagrees = verdict.suggestedClassId && verdict.suggestedClassId !== verdict.classId;
            return (
              <div
                key={verdict.id}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 sm:flex-row"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={example.url}
                  alt=""
                  className="h-32 w-32 shrink-0 rounded-xl border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {disagrees ? (
                      <>
                        You filed this under{" "}
                        <strong className="font-semibold">{nameOf(verdict.classId)}</strong>. Claude
                        thinks it belongs in{" "}
                        <strong className="font-semibold">{nameOf(verdict.suggestedClassId)}</strong>.
                      </>
                    ) : verdict.suggestedClassId === null ? (
                      <>Claude couldn&apos;t tell what this photo shows.</>
                    ) : (
                      <>
                        Claude agrees this is{" "}
                        <strong className="font-semibold">{nameOf(verdict.classId)}</strong>, but
                        isn&apos;t confident.
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    &ldquo;{verdict.note}&rdquo; · {Math.round(verdict.confidence * 100)}% confident
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => resolve(verdict.id)}
                      className="rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                    >
                      Keep in {nameOf(verdict.classId)}
                    </button>
                    {disagrees && (
                      <button
                        onClick={() => {
                          onMoveExample(verdict.classId, verdict.id, verdict.suggestedClassId!);
                          resolve(verdict.id);
                        }}
                        className="rounded-full px-4 py-1.5 text-xs font-semibold text-accent-ink transition-transform hover:scale-[1.03]"
                        style={{
                          backgroundImage:
                            "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                        }}
                      >
                        Move to {nameOf(verdict.suggestedClassId)}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onDeleteExample(verdict.classId, verdict.id);
                        resolve(verdict.id);
                      }}
                      className="rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      <Footer onBack={onBack} onContinue={onContinue} />
    </div>
  );
}

function Footer({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
          style={{
            backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
          }}
        >
          Train
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Training runs in this tab and takes seconds — a pretrained vision model does the heavy
        lifting, and only a small classifier on top actually learns your groups.
      </p>
    </div>
  );
}
