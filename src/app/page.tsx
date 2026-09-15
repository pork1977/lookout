import Header from "@/components/Header";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import PresetIdeas from "@/components/PresetIdeas";
import TriggerShowcase from "@/components/TriggerShowcase";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div id="top" className="flex flex-1 flex-col bg-background">
      <Header />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <PresetIdeas />
        <TriggerShowcase />
      </main>
      <Footer />
    </div>
  );
}
