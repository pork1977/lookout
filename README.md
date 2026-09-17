# Lookout

Teach your camera to notice anything. Describe what you want it to catch, show it a few photos, train a detector in your browser in seconds, and have it speak, notify, or post to Slack, Discord, a webhook or email the moment it sees it. No code, no dataset, no machine learning background.

**Live:** [lookout.vision](https://lookout.vision)

![Training a detector and testing it live on the webcam](docs/screenshots/train-live.png)

## What it does

1. **Describe** what you want it to notice, in your own words, and the groups it should tell apart ("holding a pen" and "not holding a pen").
2. **Show it examples.** Hold a button for a burst of webcam shots, or drop in photos. Five per group is enough to start.
3. **Review and label (optional).** Claude looks over your photos and flags any that seem to be in the wrong group, so you only check the doubtful ones.
4. **Train.** A few seconds, in the tab. Then point the camera at the thing and watch the confidence bars move. Switch on *Show what it's looking at* to see which part of the picture made it decide.
5. **Triggers.** Pick what it should watch for, how long it has to hold, and what happens: speak, banner, browser notification, Slack, Discord, any webhook, or email. Watch with up to three cameras and choose whether any camera or every camera has to see it.

Detectors save themselves in your browser as you go. An optional account backs them up so you can bring them onto another machine.

![The live demo tracking everyday objects across several cameras at once](docs/screenshots/multi-camera.png)

The homepage also has a live demo that recognises around 80 everyday objects with moving boxes, across several cameras at once, with nothing to train.

## How it works

- **Training runs in your browser.** A frozen [MobileNet v2](https://github.com/tensorflow/tfjs-models/tree/master/mobilenet) turns each photo into a 1280-number fingerprint, and a small two-layer classifier is trained on those with [TensorFlow.js](https://www.tensorflow.org/js). This is transfer learning, the same idea behind Google's Teachable Machine: seconds of work on the GPU you already have, no server, no upload.
- **"What it's looking at"** is a class activation map that costs almost nothing. MobileNet's fingerprint is the average of a 7×7 grid of regional features, so Lookout reads the grid, averages it for the normal prediction, and also runs the classifier on each region to see which ones look like the group. If the model internals it relies on aren't available, the switch simply hides.
- **Triggers are smoothed, not twitchy.** Scores are averaged over roughly a second, a condition has to hold for a dwell time before firing, and a cooldown stops repeats. With several cameras, each one votes yes, no, or abstains (when it's unsure, say it can only see half of you), so "I've left my desk" doesn't fire while another camera can still see you.
- **The live demo** uses [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), starting on a small model and upgrading to a more accurate one in the background. *Sharper detection* hands the work to Google's [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector) EfficientDet-Lite0, an extra 7MB download, and drops back to COCO-SSD automatically if a device can't run it.
- **Labelling help** sends only the photos you ask it to check to Claude (Haiku 4.5), with structured output so every answer maps back to a real photo.
- **Anything that leaves the browser** (Slack, Discord, webhooks, email) goes through a server route, so webhook URLs and keys never sit in the page. Webhooks must be https, and addresses that resolve to private or reserved networks are refused.
- **Accounts** are [Supabase](https://supabase.com) with row-level security on every table and a private storage bucket. Backup and restore are explicit buttons rather than background sync, so nothing is ever silently overwritten.

## Optional features and keys

Every integration is switched on by an environment variable. Leave one out and that feature is disabled in the UI with a note saying why; nothing else breaks. See [`.env.example`](.env.example) for the list.

| Variable | Turns on |
| --- | --- |
| `ANTHROPIC_API_KEY` | AI-assisted labelling |
| `BREVO_API_KEY` or `RESEND_API_KEY`, plus `EMAIL_FROM` | Email triggers |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Accounts and backup |

**No key or secret is committed to this repository.** Real values belong in `.env.local` (gitignored) or your host's project settings. A pre-commit hook refuses any commit that puts a value into `.env.example`.

## Running it locally

```bash
npm install
git config core.hooksPath .githooks
cp .env.example .env.local
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Everything except labelling, email and accounts works with no keys at all.

If you use accounts, apply the migrations in [`supabase/migrations`](supabase/migrations) to your own project.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript, Tailwind) on [Vercel](https://vercel.com)
- [TensorFlow.js](https://www.tensorflow.org/js) with MobileNet and COCO-SSD, plus [MediaPipe Tasks](https://ai.google.dev/edge/mediapipe) as an option
- [Claude](https://www.anthropic.com/claude) via the Anthropic SDK for labelling
- [Supabase](https://supabase.com) for auth, Postgres and storage
- IndexedDB for on-device persistence
