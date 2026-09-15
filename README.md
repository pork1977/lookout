# Lookout

> Working name, not final.

Build a custom AI detector that watches your webcam and reacts the moment it sees something specific, no code, no dataset, no machine learning background needed.

<!-- TODO: replace with a real screenshot/GIF of the live demo once the landing page exists. -->
<!-- ![Lookout screenshot](docs/screenshot.png) -->

## What this actually is (plain English)

You point your laptop camera at something and describe, in your own words, what you want it to notice: "tell me when I'm holding a drink", "tell me when someone walks up behind me", whatever you like. You show it a handful of example photos or webcam snapshots of that thing happening (and a few of it *not* happening). The site trains a small AI model on your examples, right there in your browser, in a few seconds. From then on, that model watches your camera live and fires whatever reaction you picked: it can speak out loud, pop up a notification, post to Slack or Discord, call any webhook, or send you an email.

Nothing about your camera feed leaves your computer unless you explicitly ask for AI-assisted help labeling your example photos.

## How it works (a bit more technical)

- **Detection runs in your browser.** A small pretrained vision model ([MobileNet](https://github.com/tensorflow/tfjs-models) via [TensorFlow.js](https://www.tensorflow.org/js)) extracts features from each camera frame, and a tiny classifier head you train on your own examples decides whether your thing is present. This is the same "transfer learning" trick behind Google's Teachable Machine, training takes seconds, not hours, and needs no server.
- **Common objects get real moving bounding boxes for free**, using a pretrained detector ([COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)) that already recognizes ~80 everyday objects (people, cups, phones, pets, etc). Nothing to train for these.
- **Your own custom class gets an approximate live localization box too**, via a coarse grid scan rather than a fully trained object detector, fast enough to run in real time, honestly labeled as an approximation rather than a precision detection.
- **AI-assisted labeling** (optional): if you've configured an Anthropic API key, Claude looks at your uploaded example photos and proposes labels, so you only have to review the ones it's unsure about instead of labeling everything by hand.
- **Trigger actions that leave the browser** (Slack, Discord, generic webhooks, email) are dispatched from a small server-side API route, not directly from your browser tab. This keeps webhook URLs and API keys out of the client bundle, and works around the fact that some webhook providers (Slack, notably) block direct cross-origin browser requests anyway.

## Feature flags via environment variables

Every optional integration is gated behind an environment variable. If a key isn't set, that feature is cleanly disabled in the UI with a message explaining why, nothing crashes, and nothing silently no-ops. See [`.env.example`](.env.example) for the full list and what each one controls.

**No API key or secret is ever committed to this repository.** Everything sensitive is a runtime environment variable, set in your own deployment (e.g. Vercel project settings), never in code.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in whichever keys you have
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript) on [Vercel](https://vercel.com)
- [Supabase](https://supabase.com) for auth, storage, and the saved-projects database
- [TensorFlow.js](https://www.tensorflow.org/js) for in-browser training and inference
- [Claude](https://www.anthropic.com/claude) (optional) for AI-assisted example labeling
