export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="relative flex h-6 w-6 items-center justify-center rounded-md border-2 border-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          Lookout
        </a>
        <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
          <a href="#demo" className="transition-colors hover:text-foreground">
            Live demo
          </a>
          <a href="#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#triggers" className="transition-colors hover:text-foreground">
            Triggers
          </a>
          <a
            href="https://github.com/pork1977/lookout"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
        <a
          href="#demo"
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
        >
          Try it live
        </a>
      </div>
    </header>
  );
}
