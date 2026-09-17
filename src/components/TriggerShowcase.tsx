import type { SVGProps } from "react";

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

const triggers = [
  {
    name: "Speak out loud",
    tag: "Home",
    body: "Speaks a phrase you write, such as “Why thank you, I'll enjoy that tea!”, when it fires.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
        <path d="M19 6a8.5 8.5 0 0 1 0 12" />
      </IconBase>
    ),
  },
  {
    name: "On-screen banner",
    tag: "Anywhere",
    body: "Shows an alert on the page. There's nothing to set up.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <path d="M12 3 3 8v8l9 5 9-5V8l-9-5Z" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </IconBase>
    ),
  },
  {
    name: "Push notification",
    tag: "Home & office",
    body: "Shows a desktop notification, including while the tab is in the background.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
        <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
      </IconBase>
    ),
  },
  {
    name: "Slack message",
    tag: "Office",
    body: "Posts to a channel through an incoming webhook.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <rect x="4" y="4" width="16" height="13" rx="2" />
        <path d="M8 21h8" />
        <path d="M8 17v4" />
        <path d="M16 17v4" />
      </IconBase>
    ),
  },
  {
    name: "Discord message",
    tag: "Home",
    body: "Posts to a Discord channel through a channel webhook.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <rect x="4" y="4" width="16" height="13" rx="2" />
        <path d="M8 21h8" />
        <path d="M8 17v4" />
        <path d="M16 17v4" />
      </IconBase>
    ),
  },
  {
    name: "Any webhook",
    tag: "Power users",
    body: "Sends a JSON POST to a URL you choose, which works with tools like Zapier, Home Assistant and n8n.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <path d="M9 15 15 9" />
        <path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
        <path d="M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5" />
      </IconBase>
    ),
  },
  {
    name: "Email",
    tag: "Office",
    body: "Sends an email when the detector sees what it's watching for.",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <IconBase {...p}>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </IconBase>
    ),
  },
];

export default function TriggerShowcase() {
  return (
    <section id="triggers" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Pick what happens when it fires
          </h2>
          <p className="mt-4 text-muted">
            A detector can run one action or several at the same time.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {triggers.map((trigger) => (
            <div
              key={trigger.name}
              className="rounded-2xl border border-border bg-surface p-6 transition-all hover:border-border-strong hover:shadow-[0_20px_60px_-30px_var(--glow)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-strong text-accent">
                  <trigger.icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted">
                  {trigger.tag}
                </span>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">{trigger.name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{trigger.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
