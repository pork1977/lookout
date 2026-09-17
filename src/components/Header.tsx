import Link from "next/link";
import ThemeSwitcher from "./ThemeSwitcher";

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="relative flex h-6 w-6 items-center justify-center rounded-md border-2 border-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          Lookout
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
          <Link href="/#demo" className="transition-colors hover:text-foreground">
            Live demo
          </Link>
          <Link href="/#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="/#triggers" className="transition-colors hover:text-foreground">
            Triggers
          </Link>
          <Link href="/#faq" className="transition-colors hover:text-foreground">
            FAQ
          </Link>
          <a
            href="https://github.com/pork1977/lookout"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <Link
            href="/build"
            className="rounded-full px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Build yours
          </Link>
        </div>
      </div>
    </header>
  );
}
