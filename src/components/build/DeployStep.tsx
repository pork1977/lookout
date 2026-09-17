"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import {
  getMyShare,
  publishShare,
  shareUrl,
  unpublishShare,
  type ShareStatus,
} from "@/lib/shareDetector";
import { getSupabase } from "@/lib/supabaseClient";
import type { TrainedHead } from "@/lib/trainer";
import type { TriggerSettings } from "@/lib/triggerSettings";
import { OPEN_ACCOUNT_EVENT } from "./AccountPanel";
import type { DetectorClass } from "./types";

const ACTION_LABELS: Record<string, string> = {
  speak: "say it out loud",
  banner: "show a banner",
  notify: "send a browser notification",
};

export default function DeployStep({
  detectorId,
  detectorName,
  classes,
  head,
  settings,
  onBack,
}: {
  detectorId: string | null;
  detectorName: string;
  classes: DetectorClass[];
  head: TrainedHead | null;
  settings: TriggerSettings;
  onBack: () => void;
}) {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [share, setShare] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!user || !detectorId) return;
    let cancelled = false;
    getMyShare(detectorId)
      .then((found) => {
        if (!cancelled) setShare(found);
      })
      .catch(() => {
        if (!cancelled) setShare(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, detectorId]);

  const publish = useCallback(async () => {
    if (!head || !detectorId) return;
    setBusy("publish");
    setError(null);
    try {
      const result = await publishShare({
        localId: detectorId,
        name: detectorName,
        groups: classes.map((c) => ({ id: c.id, name: c.name })),
        head,
        settings,
      });
      setShare(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't share it.");
    } finally {
      setBusy(null);
    }
  }, [head, detectorId, detectorName, classes, settings]);

  const unpublish = useCallback(async () => {
    if (!detectorId) return;
    setBusy("unpublish");
    setError(null);
    try {
      await unpublishShare(detectorId);
      setShare(null);
      setConfirmStop(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't stop sharing it.");
    } finally {
      setBusy(null);
    }
  }, [detectorId]);

  const exportZip = useCallback(async () => {
    if (!head) return;
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      // Loaded on demand: the zip library is only needed at the moment of export.
      const { downloadDetectorExport } = await import("@/lib/exportDetector");
      const result = await downloadDetectorExport({
        name: detectorName,
        groups: classes,
        head,
        settings,
      });
      const megabytes = (result.bytes / (1024 * 1024)).toFixed(1);
      setExportNote(`Downloaded ${result.fileName} (${megabytes}MB). Unzip it and open index.html.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export it.");
    } finally {
      setExporting(false);
    }
  }, [head, detectorName, classes, settings]);

  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the link is still selectable */
    }
  }, []);

  const watched = classes.find((c) => c.id === settings.rule.classId) ?? classes[0];
  const actions = settings.clientActions.map((a) => ACTION_LABELS[a]).filter(Boolean);
  const url = share ? shareUrl(share.slug) : null;

  let body: React.ReactNode;
  if (!head) {
    body = (
      <p className="text-sm leading-relaxed text-muted">
        There&apos;s nothing to share until it&apos;s trained. Go back to Train, then come here.
      </p>
    );
  } else if (!supabase) {
    body = (
      <p className="text-sm leading-relaxed text-muted">
        Sharing is switched off on this deployment because accounts aren&apos;t configured.
      </p>
    );
  } else if (!authChecked) {
    body = <p className="text-sm text-muted">Checking your account…</p>;
  } else if (!user) {
    body = (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted">
          Creating a link needs you to be signed in, so the link has an owner who can update or
          stop it. Anyone you send it to can open it without an account.
        </p>
        <button
          onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT))}
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
          style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
        >
          Sign in to share
        </button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        {url ? (
          <div>
            <span className="text-xs font-medium text-foreground">Your link</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-border-strong bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
              />
              <button
                onClick={() => copy(url)}
                className="rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                Open
              </a>
            </div>
            <p className="mt-2 text-xs text-muted">
              Last updated {new Date(share!.updatedAt).toLocaleString()}. Retrained or changed
              the triggers since? Update it and the same link picks up the changes.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            Not shared yet. Creating a link uploads the trained model and its settings. Your
            photos aren&apos;t included.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={publish}
            disabled={busy !== null}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
          >
            {busy === "publish" ? "Uploading…" : url ? "Update the link" : "Create a link"}
          </button>
          <button
            onClick={exportZip}
            disabled={exporting}
            className="rounded-full border border-border-strong px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? "Preparing the zip…" : "Export"}
          </button>
          {url &&
            (confirmStop ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                The link will stop working for everyone.
                <button
                  onClick={() => setConfirmStop(false)}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised"
                >
                  Keep it
                </button>
                <button
                  onClick={unpublish}
                  disabled={busy !== null}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised disabled:opacity-50"
                >
                  {busy === "unpublish" ? "Stopping…" : "Stop sharing"}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmStop(true)}
                className="rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                Stop sharing
              </button>
            ))}
        </div>
        {exportNote && <p className="text-sm text-muted">{exportNote}</p>}
        {error && <p className="text-sm text-foreground">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <section className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Share or export</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            <span className="text-foreground">Create a link</span> to run this detector on
            another phone or laptop with a camera. The person opening it doesn&apos;t need an
            account, and the detector can&apos;t be changed from the link.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            <span className="text-foreground">Export</span> downloads a zip for developers: the
            trained model, its metadata, your photos in a folder per group, and an index.html
            that runs the detector when opened.
          </p>
          <div className="mt-5">{body}</div>
        </section>

        <aside className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            What the link does
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted">
            <li>
              Watches for{" "}
              <span className="text-accent">{watched?.name || "Untitled group"}</span> for at
              least {settings.rule.dwellSeconds}s, then waits {settings.rule.cooldownSeconds}s
              before firing again.
            </li>
            <li>
              {actions.length
                ? `Then it will ${actions.join(", ")}.`
                : "No on-device action is ticked, so it will only log what it sees."}
            </li>
            <li>
              Slack, Discord, webhooks and email stay with you. A shared link can&apos;t send
              anything anywhere.
            </li>
            <li>The model runs on the viewer&apos;s device. No video leaves it.</li>
          </ul>
        </aside>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <button
          onClick={onBack}
          className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          Back
        </button>
      </div>
    </div>
  );
}
