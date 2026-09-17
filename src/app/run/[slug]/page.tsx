import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import RunDetector from "@/components/run/RunDetector";

export const metadata: Metadata = {
  title: "Run a shared detector | Lookout",
  description: "A detector someone built with Lookout, running on your own camera.",
  // Shared links carry someone's own group names. They're for the people they
  // were sent to, not for search results.
  robots: { index: false, follow: false },
};

export default async function RunPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="flex flex-1 flex-col bg-background">
      <Header />
      <main className="flex-1">
        <RunDetector slug={slug} />
      </main>
      <Footer />
    </div>
  );
}
