export default function Footer() {
  return (
    <footer className="border-t border-border py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="relative flex h-5 w-5 items-center justify-center rounded-md border-2 border-accent">
            <span className="h-1 w-1 rounded-full bg-accent" />
          </span>
          <span>Lookout</span>
        </div>
        <p>Detection runs in your browser. Nothing is uploaded unless you ask it to be.</p>
        <a
          href="https://github.com/pork1977/lookout"
          className="transition-colors hover:text-foreground"
        >
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}
