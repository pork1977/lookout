"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import {
  backupDetector,
  deleteCloudDetector,
  listCloudDetectors,
  restoreDetector,
  type CloudDetector,
  type SyncProgress,
} from "@/lib/cloudSync";
import ProgressBar from "./ProgressBar";

export default function AccountPanel({
  currentDetectorId,
  onRestored,
}: {
  currentDetectorId: string | null;
  onRestored: (localId: string) => void;
}) {
  const supabase = getSupabase();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudDetector[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const refreshCloud = useCallback(() => {
    if (!user) return;
    listCloudDetectors()
      .then(setCloud)
      .catch((err) => setMessage(err instanceof Error ? err.message : "Couldn't list backups."));
  }, [user]);

  useEffect(() => {
    if (open && user) refreshCloud();
  }, [open, user, refreshCloud]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Accounts are optional. Without a project configured there's nothing to show
  // and everything still works locally, so the control simply isn't there.
  if (!supabase) return null;

  async function withBusy(label: string, work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: user ? "var(--accent)" : "var(--muted)" }}
        />
        {/* "Sign in" hid the sign-up behind a label that reads as
            existing-users-only, which is exactly how it got missed. "Account"
            covers both, and the dot carries the signed-in state. */}
        Account
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-80 rounded-2xl border border-border-strong bg-surface p-4 shadow-2xl">
          {!user ? (
            <>
              <h3 className="text-sm font-semibold text-foreground">
                Create an account, or sign in
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Optional. Your detectors already live in this browser — an account is for backing
                them up and pulling them onto another machine. New here? Fill both fields and
                choose <span className="text-foreground">Create account</span>.
              </p>
              <div className="mt-4 space-y-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy || !email || !password}
                  onClick={() =>
                    withBusy("Sign in", async () => {
                      const { error } = await supabase.auth.signInWithPassword({ email, password });
                      if (error) throw new Error(error.message);
                      setPassword("");
                    })
                  }
                  className="flex-1 rounded-full px-4 py-2 text-xs font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                  style={{
                    backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                  }}
                >
                  Sign in
                </button>
                <button
                  disabled={busy || !email || !password}
                  onClick={() =>
                    withBusy("Sign up", async () => {
                      const { data, error } = await supabase.auth.signUp({ email, password });
                      if (error) throw new Error(error.message);
                      setPassword("");
                      // With email confirmation on, there's no session yet and
                      // nothing appears to happen unless we say so.
                      if (!data.session) setMessage("Check your email to confirm the account.");
                    })
                  }
                  className="flex-1 rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create account
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{user.email}</h3>
                  <p className="text-xs text-muted">
                    {cloud.length} backed up detector{cloud.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  onClick={() => withBusy("Sign out", async () => void (await supabase.auth.signOut()))}
                  className="shrink-0 rounded-full border border-border-strong px-3 py-1 text-[11px] text-foreground hover:bg-surface-raised"
                >
                  Sign out
                </button>
              </div>

              <button
                disabled={busy || !currentDetectorId}
                onClick={() =>
                  withBusy("Backup", async () => {
                    await backupDetector(currentDetectorId as string, setProgress);
                    setMessage("Backed up.");
                    refreshCloud();
                  })
                }
                className="mt-4 w-full rounded-full px-4 py-2 text-xs font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                style={{
                  backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                }}
              >
                Back up the open detector
              </button>

              {progress && (
                <div className="mt-3">
                  <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
                  <p className="mt-1.5 text-[11px] text-muted">{progress.label}</p>
                </div>
              )}

              {cloud.length > 0 && (
                <div className="mt-4 space-y-1 border-t border-border pt-3">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    In your account
                  </p>
                  {cloud.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <button
                        disabled={busy}
                        onClick={() =>
                          withBusy("Restore", async () => {
                            const localId = await restoreDetector(item.id, setProgress);
                            onRestored(localId);
                            setMessage("Brought back to this browser.");
                            setOpen(false);
                          })
                        }
                        className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-surface-raised disabled:opacity-40"
                      >
                        <span className="block truncate text-sm text-foreground">
                          {item.name || "Untitled detector"}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {item.exampleCount} photo{item.exampleCount === 1 ? "" : "s"} · tap to
                          bring back
                        </span>
                      </button>
                      <button
                        disabled={busy}
                        aria-label={`Remove ${item.name || "detector"} from the account`}
                        onClick={() =>
                          withBusy("Delete", async () => {
                            await deleteCloudDetector(item.id);
                            refreshCloud();
                          })
                        }
                        className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
                    Bringing one back replaces the local copy of that detector.
                  </p>
                </div>
              )}
            </>
          )}

          {message && <p className="mt-3 text-xs text-foreground">{message}</p>}
        </div>
      )}
    </div>
  );
}
