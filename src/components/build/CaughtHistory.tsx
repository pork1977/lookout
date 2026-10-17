"use client";

import { useCallback, useEffect, useState } from "react";
import { clearHistory, listHistory, type HistoryRecord } from "@/lib/detectorStore";

/**
 * What this detector has caught, across sessions.
 *
 * The live log beside the camera only lasts as long as the tab, which is the
 * wrong lifetime for the thing people actually want: close it, come back
 * tomorrow, and see what happened while you were not watching.
 *
 * Reads from IndexedDB, like the photos. Nothing here is uploaded.
 */
export default function CaughtHistory({
  detectorId,
  /** Bumped by the parent on every trigger, so the list refreshes itself. */
  refreshKey,
}: {
  detectorId: string | null;
  refreshKey: number;
}) {
  const [entries, setEntries] = useState<HistoryRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!detectorId) return;
    let cancelled = false;
    listHistory(detectorId, 50)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        // One object URL per thumbnail, released when the list is replaced.
        const next: Record<string, string> = {};
        rows.forEach((row) => {
          if (row.thumb) next[row.id] = URL.createObjectURL(row.thumb);
        });
        setUrls((previous) => {
          Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detectorId, refreshKey]);

  useEffect(
    () => () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    },
    // Unmount only. Listing urls here would revoke the thumbnails still on
    // screen every time a new trigger arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const clear = useCallback(() => {
    if (!detectorId) return;
    clearHistory(detectorId)
      .then(() => {
        setEntries([]);
        setConfirmClear(false);
      })
      .catch(() => undefined);
  }, [detectorId]);

  if (!detectorId) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">What it caught</h3>
        {entries.length > 0 &&
          (confirmClear ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-full border border-border-strong px-3 py-1 text-[11px] text-foreground hover:bg-surface-raised"
              >
                Keep
              </button>
              <button
                onClick={clear}
                className="rounded-full border border-border-strong px-3 py-1 text-[11px] text-foreground hover:bg-surface-raised"
              >
                Clear it
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="rounded-full border border-border-strong px-3 py-1 text-[11px] text-muted hover:bg-surface-raised hover:text-foreground"
            >
              Clear
            </button>
          ))}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Nothing yet. Once it triggers, every catch is kept here in this browser, so you can
          close the tab and see later what it spotted while you were away.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3">
              {urls[entry.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[entry.id]}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-lg border border-border bg-background" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-foreground">{entry.message}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {formatWhen(entry.at)} · {Math.round(entry.confidence * 100)}%
                  {entry.cameras ? ` · ${entry.cameras}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "14:32" for today and "Tue 14:32" for anything older. A full date is noise
 * on a list that only keeps a few days.
 */
function formatWhen(at: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    when.getDate() === today.getDate() &&
    when.getMonth() === today.getMonth() &&
    when.getFullYear() === today.getFullYear();
  if (sameDay) return time;
  return `${when.toLocaleDateString([], { weekday: "short" })} ${time}`;
}
