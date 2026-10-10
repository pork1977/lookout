"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";

/**
 * The numbers from the events table, for whoever is listed in public.admins.
 *
 * Nothing here is privileged on the client: the page asks two database
 * functions for already-aggregated rows, and those functions refuse anyone
 * who isn't an admin. Hiding the page would not be security, and showing it
 * isn't a risk. See supabase/migrations/0005_admin.sql.
 */

interface FunnelRow {
  source: string;
  visits: number;
  opened_builder: number;
  trained_one: number;
  trained_and_saw_it_fire: number;
}

interface CountRow {
  name: string;
  events: number;
  sessions: number;
}

const RANGES = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

/** What each event means, so the table reads as English rather than as keys. */
const EVENT_LABELS: Record<string, string> = {
  page_viewed: "Page viewed",
  live_demo_started: "Live demo started",
  build_step_reached: "Builder step reached",
  ai_labelling_used: "AI labelling used",
  training_started: "Training started",
  detector_trained: "Detector trained",
  training_failed: "Training failed",
  watch_started: "Watching started",
  detector_fired: "Detector fired",
  share_link_created: "Run link created",
  detector_exported: "Detector exported",
  account_created: "Account created",
};

export default function AdminDashboard() {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  // Nothing to wait for when the project isn't configured, so that case
  // starts already checked rather than being settled by an effect.
  const [checked, setChecked] = useState(!supabase);
  const [adminFlag, setAdminFlag] = useState<boolean | null>(null);
  const [days, setDays] = useState(7);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [counts, setCounts] = useState<CountRow[]>([]);
  /** Which window the rows on screen belong to, which is also how we know we're waiting. */
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Signing out has to drop the previous answer, and deriving it rather than
  // clearing it in an effect keeps that impossible to get wrong.
  const isAdmin = user ? adminFlag : null;

  // Sign-in, for the case of landing here on a machine that isn't signed in.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !user) return;
    supabase
      .rpc("is_admin")
      .then(({ data, error: rpcError }) => setAdminFlag(rpcError ? false : Boolean(data)));
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !isAdmin) return;
    let cancelled = false;
    Promise.all([
      supabase.rpc("admin_funnel", { p_days: days }),
      supabase.rpc("admin_event_counts", { p_days: days }),
    ]).then(([funnelResult, countsResult]) => {
      // Switching window twice quickly must not let the slower answer win.
      if (cancelled) return;
      const failed = funnelResult.error ?? countsResult.error;
      if (failed) {
        setError(failed.message);
      } else {
        setError(null);
        setFunnel((funnelResult.data ?? []) as FunnelRow[]);
        setCounts((countsResult.data ?? []) as CountRow[]);
      }
      setLoadedFor(days);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, isAdmin, days, reloads]);

  const loading = isAdmin === true && loadedFor !== days;

  const refresh = useCallback(() => {
    setLoadedFor(null);
    setReloads((n) => n + 1);
  }, []);

  if (!supabase) {
    return <Note>Accounts aren&rsquo;t configured on this deployment, so there is nothing to read.</Note>;
  }

  if (!checked) return <Note>Checking&hellip;</Note>;

  if (!user) {
    return (
      <Panel title="Sign in">
        <p className="text-sm text-muted">
          This page is for the site owner. Sign in with an existing account.
        </p>
        <form
          className="mt-4 flex max-w-sm flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { error: signInError } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            if (signInError) setError(signInError.message);
            setPassword("");
            setBusy(false);
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="rounded-full px-4 py-2 text-xs font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </Panel>
    );
  }

  if (isAdmin === false) {
    return (
      <Note>
        You&rsquo;re signed in, but this account isn&rsquo;t an admin, so there is nothing to show.
      </Note>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => setDays(range.days)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                days === range.days
                  ? "border-border-strong bg-surface-raised text-foreground"
                  : "border-border text-muted hover:bg-surface-raised"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <Panel title="How far people got">
        <p className="mb-4 text-xs text-muted">
          One row per visit, grouped by where it came from. The last column is the one that
          matters: trained a detector <em>and</em> watched it fire.
        </p>
        {funnel.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={["Source", "Visits", "Opened builder", "Trained", "Trained and saw it fire"]}
            rows={funnel.map((row) => [
              row.source,
              row.visits,
              row.opened_builder,
              row.trained_one,
              row.trained_and_saw_it_fire,
            ])}
          />
        )}
      </Panel>

      <Panel title="What happened">
        <p className="mb-4 text-xs text-muted">
          Every event in the window. Sessions counts each visit once, however many times it
          did the thing.
        </p>
        {counts.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={["Event", "Times", "Visits"]}
            rows={counts.map((row) => [
              EVENT_LABELS[row.name] ?? row.name,
              row.events,
              row.sessions,
            ])}
          />
        )}
      </Panel>
    </div>
  );
}

/**
 * The three bits of furniture below are shared so that the next thing added
 * here, whatever it turns out to be, is a new Panel and not a new design.
 */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function Empty() {
  return <p className="text-sm text-muted">Nothing recorded in this window yet.</p>;
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((cell, i) => (
              <th
                key={cell}
                className={`pb-2 text-xs font-medium uppercase tracking-wider text-muted ${
                  i === 0 ? "" : "text-right"
                }`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border/50 last:border-0">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`py-2 tabular-nums ${i === 0 ? "font-medium text-foreground" : "text-right text-muted"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
