import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

// Runs before first paint so the stored theme applies immediately, no flash
// of the default theme. Kept tiny and dependency-free on purpose.
const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})||${JSON.stringify(DEFAULT_THEME)};document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lookout: teach your camera to notice anything",
  description:
    "Build a custom AI detector that watches your webcam and reacts the moment it sees something specific. No code, no dataset, no machine learning background needed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
