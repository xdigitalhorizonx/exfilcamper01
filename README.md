# exfilcamper01

Static artist site. No build step. Deploys from `main` on Vercel.

- **Tracks** → `assets/data/tracks.js` (real SoundCloud data + SoundCloud's own 1800-sample waveform per track; `drops: [seconds]` overrides the auto-detected IMPACT markers).
- **Blog (Intel)** → add a page in `/intel/` (copy `prepare-for-escape.html`) and an entry in `assets/data/intel.js`.
- **Bio / contact** → `index.html` (#dossier, #comms).
- **Hero video** → `assets/video/gate3-v4.mp4` (seedance render of an original pixel-art frame, re-pixelated to a 320px grid, 12fps ping-pong loop).

Local preview: `npx serve .`

**Cache:** JS/CSS/data links in `index.html` carry `?v=<timestamp>` — bump it on every deploy (media files are cached for a year, so give changed images/videos a new filename instead).
