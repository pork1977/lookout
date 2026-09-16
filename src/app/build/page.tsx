import type { Metadata } from "next";
import BuildWizard from "@/components/build/BuildWizard";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Build a detector — Lookout",
  description:
    "Describe what you want your camera to notice, show it a handful of examples, and train a custom detector right in your browser.",
};

export default function BuildPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BuildWizard />
      </main>
      <Footer />
    </div>
  );
}
