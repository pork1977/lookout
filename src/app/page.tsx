import AuthHashCatcher from "@/components/AuthHashCatcher";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import PresetIdeas from "@/components/PresetIdeas";
import TriggerShowcase from "@/components/TriggerShowcase";
import Faq, { faqs } from "@/components/Faq";
import Footer from "@/components/Footer";

// Read by search results and AI answer engines alongside the FAQ section
// itself; keeping it next to `faqs` means the two can't drift apart.
function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

function softwareAppJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lookout",
    url: "https://lookout.vision",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any (runs in a web browser)",
    description:
      "Build a custom camera detector in the browser. Describe what it should notice, give it example photos, and train a small model in the page.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export default function Home() {
  return (
    <div id="top" className="flex flex-1 flex-col bg-background">
      {/* Deliberately here and not in the layout: /auth/callback shares the
          layout and would bounce to itself. */}
      <AuthHashCatcher />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <Header />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <PresetIdeas />
        <TriggerShowcase />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
