/**
 * Pageviews. Runs after the document loads and before React hydrates, so a
 * visitor who reads the homepage and leaves is still counted.
 *
 * Everything else is recorded from the component that knows the thing
 * happened. See `src/lib/analytics.ts` for what is and isn't sent.
 */
import { trackPageView } from "@/lib/analytics";

trackPageView();

/**
 * Client-side navigation, which is how both routes into the builder work.
 * The url is where they're going; at this point the address bar still says
 * where they are.
 */
export function onRouterTransitionStart(url: string) {
  let pathname: string | undefined;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    // A url this can't parse isn't worth losing the pageview over.
  }
  trackPageView(pathname);
}
