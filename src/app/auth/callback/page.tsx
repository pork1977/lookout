import type { Metadata } from "next";
import AuthCallback from "@/components/AuthCallback";

export const metadata: Metadata = {
  title: "Confirming your account | Lookout",
  robots: { index: false, follow: false },
};

/**
 * Where Supabase sends people after they click a confirmation link.
 *
 * A dedicated route rather than landing on the builder: the link arrives with
 * a session in the URL fragment, and this gives that a visible moment and a
 * place to explain a failure, instead of dumping someone on the wizard with a
 * few hundred characters of token in the address bar.
 */
export default function AuthCallbackPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-24">
      <AuthCallback />
    </div>
  );
}
