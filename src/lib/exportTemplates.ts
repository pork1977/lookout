import type { ExportMetadata } from "./exportDetector";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The page that ships inside an export. It is written to be read: a developer
 * opens it to see how the detector runs, so the script is plain, commented,
 * dependency-free apart from two CDN scripts, and has no build step.
 */
export function exportHtml(meta: ExportMetadata): string {
  const title = escapeHtml(meta.name);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | Lookout detector</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #0b0f0d; color: #eef3f0; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 1.6rem; margin: 0 0 4px; }
    p { color: #9aa6a0; line-height: 1.5; }
    button { background: #5cf2a3; color: #06170f; border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .layout { display: grid; gap: 20px; margin-top: 20px; }
    @media (min-width: 640px) { .layout { grid-template-columns: 320px 1fr; } }
    video { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 16px; background: #141a17; transform: scaleX(-1); }
    .bar { margin-bottom: 12px; }
    .bar-label { display: flex; justify-content: space-between; font-size: 0.9rem; }
    .track { height: 6px; background: #1d2521; border-radius: 99px; overflow: hidden; margin-top: 4px; }
    .fill { height: 100%; width: 0; background: #5cf2a3; transition: width 120ms; }
    .leader .bar-label span:first-child { color: #5cf2a3; font-weight: 600; }
    #status { font-size: 0.9rem; }
    #fired { color: #5cf2a3; font-weight: 600; min-height: 1.4em; }
    #banner {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%) translateY(-12px);
      max-width: min(90vw, 32rem); padding: 14px 20px; border-radius: 16px;
      background: #141a17; border: 1px solid #24302b; color: #eef3f0; font-weight: 600;
      text-align: center; box-shadow: 0 20px 60px -20px rgba(92, 242, 163, 0.4);
      opacity: 0; pointer-events: none; transition: opacity 160ms, transform 160ms; z-index: 50;
    }
    #banner.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    #cameraPicker { display: none; margin-top: 14px; }
    #cameraPicker label { display: block; font-size: 0.8rem; margin-bottom: 4px; }
    #cameraPicker select {
      background: #141a17; color: #eef3f0; border: 1px solid #24302b; border-radius: 10px;
      padding: 8px 10px; font-size: 0.9rem; max-width: 100%;
    }
    #cameraPicker p { font-size: 0.8rem; margin: 6px 0 0; }
    #cameraHint { display: none; font-size: 0.8rem; margin: 14px 0 0; max-width: 46rem; }
    #cameraHint code { background: #141a17; border: 1px solid #24302b; border-radius: 6px; padding: 1px 5px; }
  </style>
</head>
<body>
  <div id="banner" role="status" aria-live="polite"></div>
  <main>
    <h1>${title}</h1>
    <p>A detector exported from Lookout. Everything runs in this page: the webcam feed isn't uploaded anywhere.</p>
    <button id="start" disabled>Loading…</button>
    <div id="cameraPicker">
      <label for="cameraSelect">Camera</label>
      <select id="cameraSelect"></select>
      <p>
        Whilst you can change cameras, note that if the photos used to train this model were taken
        with a different camera, one that sees things from a different angle, distance or light,
        accuracy may drop. Retrain with photos from the camera you actually plan to use for the best
        result.
      </p>
    </div>
    <p id="cameraHint">
      Opened straight from a file, this page isn't allowed to see which cameras you have, so there's
      no camera picker and it uses whichever camera the browser hands it. Granting permission doesn't
      change that. To choose a camera, serve this folder instead: run <code>npx serve</code> in it and
      open the address that prints.
    </p>
    <div class="layout">
      <video id="camera" playsinline muted></video>
      <div>
        <div id="bars"></div>
        <p id="status"></p>
        <p id="fired"></p>
      </div>
    </div>
  </main>

  <!-- TensorFlow.js, and the MobileNet feature model the classifier was trained on. -->
  <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${meta.runtime.packageVersion}/dist/tf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@${meta.featureModel.packageVersion}/dist/mobilenet.min.js"></script>
  <!-- Only used when this page is opened straight from disk. See loadDetector(). -->
  <script src="model/detector-data.js"></script>

  <script>
    const INPUT_SIZE = 320;

    // Loads metadata.json and the trained classifier.
    //
    // Served over http(s), it reads the files like any web app would. Opened
    // straight from disk (file://), browsers block fetch(), so it falls back to
    // the copy of the same data that model/detector-data.js put on window.
    async function loadDetector() {
      try {
        const response = await fetch("metadata.json");
        if (!response.ok) throw new Error("metadata.json: HTTP " + response.status);
        const metadata = await response.json();
        const classifier = await tf.loadLayersModel("model/model.json");
        return { metadata, classifier };
      } catch (err) {
        if (!window.LOOKOUT_DETECTOR) throw err;
      }
      const data = window.LOOKOUT_DETECTOR;
      const bytes = Uint8Array.from(atob(data.weightsBase64), (c) => c.charCodeAt(0));
      const classifier = await tf.loadLayersModel(
        tf.io.fromMemory({
          modelTopology: data.model.modelTopology,
          weightSpecs: data.model.weightsManifest[0].weights,
          weightData: bytes.buffer,
        }),
      );
      return { metadata: data.metadata, classifier };
    }

    // Draws a webcam frame the way the training photos were prepared:
    // centre-cropped to a square, scaled to 320px, and mirrored.
    function drawFrame(video, canvas, mirror) {
      const ctx = canvas.getContext("2d");
      const side = Math.min(video.videoWidth, video.videoHeight);
      const sx = (video.videoWidth - side) / 2;
      const sy = (video.videoHeight - side) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (mirror) ctx.setTransform(-1, 0, 0, 1, INPUT_SIZE, 0);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, INPUT_SIZE, INPUT_SIZE);
    }

    function renderBars(labels) {
      document.getElementById("bars").innerHTML = labels
        .map((label, i) => \`<div class="bar" id="bar-\${i}">
            <div class="bar-label"><span></span><span class="pct">0%</span></div>
            <div class="track"><div class="fill"></div></div>
          </div>\`)
        .join("");
      labels.forEach((label, i) => {
        document.querySelector(\`#bar-\${i} .bar-label span\`).textContent = label;
      });
    }

    function updateBars(scores) {
      const best = scores.indexOf(Math.max(...scores));
      scores.forEach((score, i) => {
        const bar = document.getElementById(\`bar-\${i}\`);
        bar.classList.toggle("leader", i === best);
        bar.querySelector(".pct").textContent = Math.round(score * 100) + "%";
        bar.querySelector(".fill").style.width = score * 100 + "%";
      });
    }

    // Fills {what} and {confidence} in the message set up in Lookout.
    function renderMessage(template, className, confidence) {
      return template
        .replace(/\\{what\\}/g, className)
        .replace(/\\{confidence\\}/g, Math.round(confidence * 100) + "%");
    }

    function speak(text, speech) {
      if (!("speechSynthesis" in window)) return;
      // Cancel first: a run of fires otherwise queues up and talks over
      // itself long after the thing that caused it has gone.
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = speech.voiceURI
        ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === speech.voiceURI)
        : null;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang; // some engines ignore the voice without this
      }
      utterance.rate = speech.rate || 1;
      utterance.pitch = speech.pitch || 1;
      window.speechSynthesis.speak(utterance);
    }

    let bannerTimer = null;
    function showBanner(text) {
      const banner = document.getElementById("banner");
      banner.textContent = text;
      banner.classList.add("show");
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove("show"), 6000);
    }

    function notify(title, body) {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      new Notification(title, { body });
    }

    (async () => {
      const status = document.getElementById("status");
      const startButton = document.getElementById("start");

      const [{ metadata, classifier }, featureModel] = await Promise.all([
        loadDetector(),
        mobilenet.load({ version: 2, alpha: 1.0 }),
      ]);
      renderBars(metadata.labels);

      const trigger = metadata.trigger;
      const watchIndex = metadata.labels.indexOf(trigger.watchLabel);
      const requireAfterIndex = trigger.requireAfterLabel
        ? metadata.labels.indexOf(trigger.requireAfterLabel)
        : -1;
      status.textContent =
        requireAfterIndex >= 0
          ? \`Watching for "\${trigger.watchLabel}": \${Math.round(trigger.threshold * 100)}% or more for \${trigger.dwellSeconds}s, but only once it's first seen "\${trigger.requireAfterLabel}".\`
          : \`Watching for "\${trigger.watchLabel}": \${Math.round(trigger.threshold * 100)}% or more for \${trigger.dwellSeconds}s.\`;
      startButton.textContent = "Start camera";
      startButton.disabled = false;

      const video = document.getElementById("camera");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = INPUT_SIZE;
      let timer = null;

      const cameraPicker = document.getElementById("cameraPicker");
      const cameraSelect = document.getElementById("cameraSelect");
      const cameraHint = document.getElementById("cameraHint");
      // Set once a camera is actually running, from the stream itself, not
      // from the picker: on the very first start there's nothing picked yet
      // and the browser chooses, so this is how the picker finds out what it
      // chose.
      let currentDeviceId = null;

      // Labels are blank until permission has been granted at least once, so
      // this only has anything to show after the first successful start.
      async function refreshCameraList() {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        if (cams.length < 2) {
          cameraPicker.style.display = "none";
          // A page opened from a file has an opaque ("null") origin, and a
          // browser won't give one of those the real device list: whatever is
          // plugged in, enumerateDevices returns one blank entry per kind, and
          // granting camera permission doesn't change it, because there's no
          // real origin to hang that permission on. Blank ids are how that
          // state is recognised, as opposed to genuinely having one camera.
          const redacted = cams.every((cam) => !cam.deviceId);
          cameraHint.style.display =
            location.protocol === "file:" && redacted ? "block" : "none";
          return;
        }
        cameraHint.style.display = "none";
        cameraSelect.textContent = "";
        cams.forEach((cam, i) => {
          const option = document.createElement("option");
          option.value = cam.deviceId;
          option.textContent = cam.label || \`Camera \${i + 1}\`;
          cameraSelect.appendChild(option);
        });
        if (currentDeviceId) cameraSelect.value = currentDeviceId;
        cameraPicker.style.display = "block";
      }

      cameraSelect.addEventListener("change", () => {
        currentDeviceId = cameraSelect.value;
        // Switching cameras is a fresh start under the hood, so the dwell
        // clock, cooldown and arm state all reset, the same as Stop then
        // Start does today.
        if (timer) {
          stop();
          start();
        }
      });

      function stop() {
        clearInterval(timer);
        timer = null;
        video.srcObject?.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        startButton.textContent = "Start camera";
      }

      async function start() {
        startButton.disabled = true;
        // Needs a click to be allowed at all, and this one is it.
        if (
          (trigger.clientActions || []).includes("notify") &&
          "Notification" in window &&
          Notification.permission === "default"
        ) {
          await Notification.requestPermission();
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: currentDeviceId ? { deviceId: { exact: currentDeviceId } } : true,
            audio: false,
          });
          video.srcObject = stream;
          await video.play();
          currentDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? currentDeviceId;
          await refreshCameraList();
        } catch (err) {
          status.textContent = "Couldn't open the camera: " + err.message;
          startButton.disabled = false;
          return;
        }
        startButton.textContent = "Stop camera";
        startButton.disabled = false;

        let heldSince = null;
        let lastFired = 0;
        let busy = false;
        // See requireAfterLabel below: unset means always armed, i.e. today's
        // plain repeat-on-a-timer behaviour.
        let armed = requireAfterIndex < 0 || !!trigger.startArmed;

        timer = setInterval(async () => {
          if (busy || video.readyState < 2) return;
          busy = true;
          drawFrame(video, canvas, metadata.input.mirrorWebcam);

          // The two-stage detector: MobileNet turns the frame into 1280
          // numbers, and the exported classifier turns those into a score
          // per label.
          let scores;
          try {
            const output = tf.tidy(() => classifier.predict(featureModel.infer(canvas, true)));
            scores = Array.from(await output.data());
            output.dispose();
          } finally {
            busy = false;
          }
          if (!timer) return; // stopped while this frame was being scored
          updateBars(scores);

          // A simple version of Lookout's trigger: the watched label has to
          // stay above the threshold for the dwell time, then waits for the
          // cooldown before it can fire again. When requireAfterLabel is set,
          // it also has to have been "armed" by seeing that other label since
          // the last fire, so it fires once per visit rather than repeating
          // for as long as it stays in view.
          const now = Date.now();
          if (requireAfterIndex >= 0 && scores[requireAfterIndex] >= trigger.threshold) armed = true;
          if (scores[watchIndex] >= trigger.threshold) {
            heldSince ??= now;
            const held = (now - heldSince) / 1000;
            const cooled = now - lastFired >= trigger.cooldownSeconds * 1000;
            if (held >= trigger.dwellSeconds && cooled && armed) {
              lastFired = now;
              if (requireAfterIndex >= 0) armed = false;
              onDetected(metadata.labels[watchIndex], scores[watchIndex], trigger, metadata.name);
            }
          } else if (scores[watchIndex] <= trigger.releaseThreshold) {
            heldSince = null;
          }
        }, 150);
      }

      startButton.addEventListener("click", () => (timer ? stop() : start()));
    })().catch((err) => {
      document.getElementById("status").textContent = "Couldn't start: " + err.message;
    });

    // Fires the same on-device reactions Lookout offers: speech, a banner and
    // a browser notification, whichever were turned on when this was
    // exported. Slack, Discord, webhooks and email need a server to keep
    // their target secret, so they're app-only and don't appear here; add
    // your own call here for those.
    function onDetected(label, score, trigger, detectorName) {
      const message = renderMessage(trigger.template || "Lookout saw {what} ({confidence})", label, score);
      document.getElementById("fired").textContent =
        \`\${message} (\${new Date().toLocaleTimeString()})\`;

      const actions = trigger.clientActions || [];
      if (actions.includes("speak")) speak(message, trigger.speech || {});
      if (actions.includes("banner")) showBanner(message);
      if (actions.includes("notify")) notify(detectorName, message);
    }
  </script>
</body>
</html>
`;
}

export function exportReadme(meta: ExportMetadata): string {
  const groups = meta.labels
    .map((label) => {
      const p = meta.photos[label];
      return `- **${label}**: ${p.count} photos in \`${p.folder}/\``;
    })
    .join("\n");

  return `# ${meta.name}

A detector exported from [Lookout](https://lookout.vision) on ${meta.exportedAt.slice(0, 10)}.

## Run it

Open \`index.html\` in Chrome, Edge or Firefox and press **Start camera**. It needs an internet connection the first time, to load TensorFlow.js and the MobileNet feature model from their CDNs.

You can also serve the folder, for example with \`npx serve\`, and open the address it prints. The page then loads \`metadata.json\` and \`model/model.json\` directly.

Serving is worth it if you have more than one camera. A page opened from a file has an opaque origin, and browsers don't give those the real camera list: \`enumerateDevices()\` returns a single blank entry no matter how many cameras are connected, and granting permission doesn't change it. So opened from disk there's no camera picker and you get whichever camera the browser picks; served over http, the picker appears.

When it sees what it's watching for, it reacts the same way it did in Lookout: speaking, a banner, a browser notification, whichever of those were turned on when this was exported. Slack, Discord, webhook and email reactions don't carry over, since keeping their target secret needs a server this page doesn't have; \`onDetected()\` in \`index.html\` is where to add your own.

## What's in the folder

| Path | Contents |
| --- | --- |
| \`index.html\` | A working page that runs the detector on your webcam |
| \`metadata.json\` | Labels, the feature model to use, input preparation and trigger settings |
| \`model/model.json\`, \`model/weights.bin\` | The trained classifier, in TensorFlow.js layers format |
| \`model/detector-data.js\` | The same data as a script, used when \`index.html\` is opened from disk |
| \`photos/\` | The training photos, one folder per label |

Photos:

${groups}

## How the detector works

It's two models used one after the other:

1. **MobileNet v2** (\`@tensorflow-models/mobilenet\` ${meta.featureModel.packageVersion}, version 2, alpha 1.0) turns an image into 1280 numbers with \`mobilenet.infer(image, true)\`. This model is standard and isn't included here.
2. **The classifier in \`model/\`** turns those 1280 numbers into one score per label, in the order of \`labels\` in \`metadata.json\`. The scores add up to 1.

Prepare images the way the training photos were prepared, or accuracy drops without any error:

- Centre-crop to a square and scale to ${meta.input.size}px.
- Mirror webcam frames horizontally. Webcam training photos were stored mirrored, and uploaded photos weren't.

## Minimal code

\`\`\`js
import * as tf from "@tensorflow/tfjs";
import * as mobilenet from "@tensorflow-models/mobilenet";

const metadata = await (await fetch("metadata.json")).json();
const classifier = await tf.loadLayersModel("model/model.json");
const featureModel = await mobilenet.load({ version: 2, alpha: 1.0 });

// canvas: a 320x320 canvas holding a prepared frame
const output = tf.tidy(() => classifier.predict(featureModel.infer(canvas, true)));
const scores = await output.data();
output.dispose();

const best = scores.indexOf(Math.max(...scores));
console.log(metadata.labels[best], scores[best]);
\`\`\`

## Retraining

The photos are ordinary JPEGs, so they can be used with other tools too. A different feature model needs a new classifier trained with it: this one only works with MobileNet v2 at alpha 1.0.
`;
}
