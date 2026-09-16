"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabaseClient";

type State = "working" | "error" | "slow" | "unconfigured";

/** How long to wait for the session before assuming the link didn't carry one. */
const GIVE_UP_MS = 8000;

export default function AuthCallback() {
  const router = useRouter();
  const [state, setState] = useState<State>("working");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("unconfigured");
      return;
    }

    // Supabase reports failures in the fragment, not the query string, so they
    // never reach the server and have to be read here.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const failure = fragment.get("error_description") ?? fragment.get("error");
    if (failure) {
      setState("error");
      setDetail(failure.replace(/\+/g, " "));
      return;
    }

    let finished = false;
    const goOn = () => {
      if (finished) return;
      finished = true;
      // replace, not push: the tokens are in this URL, and nobody should be
      // able to land back on it with the back button.
      router.replace("/build");
    };

    // The client parses the fragment as it starts up, so the session may land
    // through either of these depending on which wins.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) goOn();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) goOn();
    });

    const timer = window.setTimeout(() => {
      if (!finished) setState("slow");
    }, GIVE_UP_MS);

    return () => {
      subscription.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
      {state === "working" && (
        <>
          <span className="animate-scan-pulse text-sm font-medium text-foreground">
            Confirming your account…
          </span>
          <p className="mt-2 text-xs text-muted">One moment.</p>
        </>
      )}

      {state === "slow" && (
        <>
          <h1 className="text-sm font-semibold text-foreground">
            That link didn&apos;t carry a session
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Confirmation links can only be used once, and they expire. If you&apos;ve already
            confirmed, just sign in.
          </p>
        </>
      )}

      {state === "error" && (
        <>
          <h1 className="text-sm font-semibold text-foreground">That link didn&apos;t work</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">{detail}</p>
        </>
      )}

      {state === "unconfigured" && (
        <>
          <h1 className="text-sm font-semibold text-foreground">Accounts aren&apos;t set up here</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            This deployment has no Supabase project configured, so there&apos;s nothing to confirm
            against.
          </p>
        </>
      )}

      {state !== "working" && (
        <Link
          href="/build"
          className="mt-5 inline-block rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
          style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
        >
          Go to the builder
        </Link>
      )}
    </div>
  );
}
