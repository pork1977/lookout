"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import {
  backupDetector,
  deleteAccount,
  deleteCloudDetector,
  listCloudDetectors,
  restoreDetector,
  type CloudDetector,
  type SyncProgress,
} from "@/lib/cloudSync";
import * as store from "@/lib/detectorStore";
import ProgressBar from "./ProgressBar";

export const OPEN_ACCOUNT_EVENT = "lookout:open-account";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** local_ids already in this browser, so a backup can be shown as "not here yet". */
  const [localIds, setLocalIds] = useState<Set<string>>(new Set());
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});
  const [confirmRestore, setConfirmRestore] = useState<CloudDetector | null>(null);
  const [confirmBackup, setConfirmBackup] = useState<CloudDetector | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // Other steps (Deploy) can ask for the panel instead of telling people to
  // go and find it.
  useEffect(() => {
    function openFromElsewhere() {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(OPEN_ACCOUNT_EVENT, openFromElsewhere);
    return () => window.removeEventListener(OPEN_ACCOUNT_EVENT, openFromElsewhere);
  }, []);

  const refreshCloud = useCallback(() => {
    if (!user) return;
    listCloudDetectors()
      .then(setCloud)
      .catch((err) => setMessage(err instanceof Error ? err.message : "Couldn't list backups."));
    // Which backups are already on this machine decides what the list says, and
    // whether restoring one would replace newer work.
    store
      .listDetectors()
      .then((local) => {
        setLocalIds(new Set(local.map((d) => d.id)));
        setLocalCounts(Object.fromEntries(local.map((d) => [d.id, d.exampleCount])));
      })
      .catch(() => undefined);
  }, [user]);

  // Kept current even while the panel is shut, so the pill can show that there
  // are backups this browser hasn't got. Landing on a fresh browser and seeing
  // an empty library was the confusing part.
  useEffect(() => {
    if (user) refreshCloud();
  }, [user, refreshCloud]);

  const missingHere = cloud.filter((item) => !localIds.has(item.localId)).length;

  const runBackup = () =>
    withBusy("Backup", async () => {
      await backupDetector(currentDetectorId as string, setProgress);
      setMessage("Backed up.");
      refreshCloud();
    });

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
    <div ref={rootRef} className="lg:relative">
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
        {missingHere > 0 && (
          <span
            className="rounded-full px-1.5 font-mono text-[10px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            title={`${missingHere} backup${missingHere === 1 ? "" : "s"} not on this browser yet`}
          >
            {missingHere}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-40 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-border-strong bg-surface p-4 shadow-2xl lg:left-auto lg:right-0">
          {!user ? (
            <>
              <h3 className="text-sm font-semibold text-foreground">
                Create an account, or sign in
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Optional. Your detectors already live in this browser.
                <br />
                An account is for backing them up and pulling them onto another machine.
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
                      const { data, error } = await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                          // Must match an entry in Supabase's redirect allow
                          // list or it's rejected and silently falls back to the
                          // project's Site URL. Derived from the current origin
                          // so a sign-up on production returns to production and
                          // one on localhost returns to localhost.
                          emailRedirectTo: `${window.location.origin}/auth/callback`,
                        },
                      });
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
              <p className="mt-3 text-xs leading-relaxed text-muted">
                New accounts get a confirmation email. If it hasn&apos;t arrived in a minute, check
                your spam folder, as it often lands there.
              </p>
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
                onClick={() => {
                  const existing = cloud.find((c) => c.localId === currentDetectorId);
                  const localCount = localCounts[currentDetectorId ?? ""] ?? 0;
                  // Backing up overwrites the copy in the account, so pushing a
                  // thinner local detector over a fuller backup destroys the
                  // difference. Same comparison as restore, other direction.
                  if (existing && existing.exampleCount > localCount) {
                    setConfirmBackup(existing);
                    return;
                  }
                  void runBackup();
                }}
                className="mt-4 w-full rounded-full px-4 py-2 text-xs font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                style={{
                  backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                }}
              >
                Back up the open detector
              </button>

              {confirmBackup && (
                <div className="mt-3 rounded-xl border border-border-strong p-2.5">
                  <p className="text-[11px] leading-relaxed text-foreground">
                    The backup of &ldquo;{confirmBackup.name || "Untitled detector"}&rdquo; has{" "}
                    {confirmBackup.exampleCount} photos, but this browser only has{" "}
                    {localCounts[currentDetectorId ?? ""] ?? 0}.
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Backing up replaces what is in your account, so the extra photos there would be
                    lost. Bring the backup here first if you want to keep them.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => setConfirmBackup(null)}
                      className="flex-1 rounded-full border border-border-strong px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-raised"
                    >
                      Leave the backup alone
                    </button>
                    <button
                      onClick={() => {
                        setConfirmBackup(null);
                        void runBackup();
                      }}
                      className="flex-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                      style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                    >
                      Overwrite anyway
                    </button>
                  </div>
                </div>
              )}

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
                        onClick={() => {
                          const localCount = localCounts[item.localId];
                          // Restoring replaces the local copy, so if this
                          // browser holds more photos than the backup does,
                          // going ahead silently would destroy work.
                          if (localCount !== undefined && localCount > item.exampleCount) {
                            setConfirmRestore(item);
                            return;
                          }
                          void withBusy("Restore", async () => {
                            const localId = await restoreDetector(item.id, setProgress);
                            onRestored(localId);
                            setMessage("Brought back to this browser.");
                            setOpen(false);
                          });
                        }}
                        className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-surface-raised disabled:opacity-40"
                      >
                        <span className="block truncate text-sm text-foreground">
                          {item.name || "Untitled detector"}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {item.exampleCount} photo{item.exampleCount === 1 ? "" : "s"} ·{" "}
                          {localIds.has(item.localId) ? (
                            "already on this browser"
                          ) : (
                            <span className="text-accent">not here yet, tap to bring it back</span>
                          )}
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
                  {confirmRestore && (
                    <div className="mt-2 rounded-xl border border-border-strong p-2.5">
                      <p className="text-[11px] leading-relaxed text-foreground">
                        This browser has {localCounts[confirmRestore.localId]} photos for
                        &ldquo;{confirmRestore.name || "Untitled detector"}&rdquo;, but the backup
                        only has {confirmRestore.exampleCount}.
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        Bringing it back replaces what is here, so the extra photos would be lost.
                        Back up first if you want to keep them.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => setConfirmRestore(null)}
                          className="flex-1 rounded-full border border-border-strong px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-raised"
                        >
                          Leave it alone
                        </button>
                        <button
                          onClick={() => {
                            const target = confirmRestore;
                            setConfirmRestore(null);
                            void withBusy("Restore", async () => {
                              const localId = await restoreDetector(target.id, setProgress);
                              onRestored(localId);
                              setMessage("Brought back to this browser.");
                              setOpen(false);
                            });
                          }}
                          className="flex-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                        >
                          Replace anyway
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
                    Bringing one back replaces the local copy of that detector. Nothing syncs on its
                    own, so use these buttons when you want it to.
                  </p>
                </div>
              )}

              <div className="mt-4 border-t border-border pt-3">
                {!confirmDelete ? (
                  <button
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                    className="text-[11px] text-muted underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Delete my account
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] leading-relaxed text-foreground">
                      This removes your account and everything backed up to it, permanently.
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted">
                      Detectors saved in this browser are not touched, so anything open here stays
                      where it is.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-full border border-border-strong px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-raised disabled:opacity-40"
                      >
                        Keep my account
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          withBusy("Delete account", async () => {
                            await deleteAccount();
                            setConfirmDelete(false);
                            setCloud([]);
                            setMessage("Your account and its backups have been deleted.");
                          })
                        }
                        className="flex-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {message && <p className="mt-3 text-xs text-foreground">{message}</p>}
        </div>
      )}
    </div>
  );
}
