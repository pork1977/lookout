import type { Metadata } from "next";
import AdminDashboard from "@/components/admin/AdminDashboard";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Admin | Lookout",
  // Kept out of search results and out of the sitemap. Not a secret, since
  // the database refuses anyone who isn't an admin, but there is no reason
  // for it to turn up in anybody's results.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <Header />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-12">
          <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-2 text-sm text-muted">
            What the site recorded. Counts only, nothing anyone typed or photographed.
          </p>
          <div className="mt-8">
            <AdminDashboard />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
