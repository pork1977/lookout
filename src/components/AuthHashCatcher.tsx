"use client";

import { useEffect } from "react";

/**
 * Safety net for auth links that land on the site root.
 *
 * When Supabase can't honour the redirect an app asks for, the URL isn't on
 * the allow list, or the list and the code have drifted apart, it falls back
 * to the project's Site URL, which is normally the site root. That arrives with
 * a session sitting in the fragment on a page that isn't looking for one, and
 * the sign-up dead-ends with tokens in the address bar.
 *
 * Rather than lose it, hand the fragment to the callback route that already
 * knows what to do with it.
 */
export default function AuthHashCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    // Only auth fragments; a plain #anchor must keep working.
    if (!/(^|[#&])(access_token|error_description|error)=/.test(hash)) return;

    // location.replace rather than the router: the fragment has to survive the
    // hop, and this keeps a URL full of tokens out of session history.
    window.location.replace(`/auth/callback${hash}`);
  }, []);

  return null;
}
