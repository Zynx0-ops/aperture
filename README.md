# Aperture

A local-first photo and video colour editor. Everything runs on the device; no
media is ever uploaded.

**Live:** https://zynx0-ops.github.io/aperture/

Every push to `main` rebuilds and redeploys the site through GitHub Actions
(`.github/workflows/deploy.yml`). To run it locally instead:

```bash
npm install
npm run dev
```

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| UI | React 18 + TypeScript + Vite | Small, fast, no runtime framework tax |
| Styling | Hand-written CSS variables | The Apple look needed exact control, not a utility framework fighting it |
| Pixels (image **and** video) | One WebGL2 fragment shader | See below |
| Video export (primary) | WebCodecs + `mp4box.js` + `mp4-muxer` | Hardware H.264, faster than realtime, audio passthrough |
| Video export (fallback) | `MediaRecorder` on `canvas.captureStream()` | Works where WebCodecs does not |

### One shader, four consumers

`src/engine/shaders.ts` is the only place pixels are altered. The same program
serves the live preview, the preset thumbnails, still export, and every frame of
a video export. Preview and export cannot drift apart, because there is no second
code path to drift into.

Ordering follows how photo tools actually behave rather than what is convenient:

- **Exposure** is applied in **linear light** (`exp2`), so it behaves like a real
  camera stop. Verified: mid-grey `128` at +1 EV lands on `176`, which is exactly
  sRGB(linear(128) x 2).
- **Temperature and tint** are channel gains that **renormalise luminance**, so
  warming an image does not also brighten it. Verified: grey `128` warmed to
  `142,126,106` at luminance `128.0 -> 128.0`.
- **Highlights/shadows** re-target luminance while holding hue and saturation,
  falling back to a neutral lift near black where the ratio is meaningless.
- **Vibrance** weights by `(1 - saturation)` and pulls back on skin tones, so it
  moves muted colour and leaves neutrals and faces alone. Verified: neutral grey
  unchanged, muted mauve `150,120,110 -> 176,114,93`.
- **Contrast, tone curve, saturation, fade** run in gamma space, which is where
  the familiar look of these controls comes from.
- **Vignette and grain** use screen-space UVs so they frame the visible output
  rather than the source texture.

Zero adjustments is a **bit-exact** pass-through: a 1200x800 identity PNG export
matched the source on all 169,413 sampled channels with `maxDiff = 0`.

### Video export

**Primary path** (`exportVideoWebCodecs.ts`) — `mp4box.js` demuxes the file into
`EncodedVideoChunk`s, `VideoDecoder` decodes, the shader processes on the GPU,
`VideoEncoder` re-encodes to H.264, and `mp4-muxer` writes the MP4. It is not
realtime-bound. Original AAC audio is copied through **without re-encoding**, so
it is bit-identical to the source. Container rotation is baked into the pixels,
because a decoded `VideoFrame` carries no display matrix — without this, iPhone
portrait clips export sideways.

Measured: a 16.05s, 1437-frame clip exported in **4.9s — 3.3x faster than
realtime** — while transcoding HEVC to H.264.

**Fallback path** (`exportVideoRecorder.ts`) — plays the clip once, renders every
frame through the same shader, and records the canvas. Audio is tapped through
WebAudio into a `MediaStreamDestination` so the export does not blast sound at
the user.

The app picks automatically and **degrades on failure, not just on capability**:
if the WebCodecs run throws part-way, it falls back to a realtime recording and
tells you why rather than leaving you with nothing.

## Tradeoffs and real limits

These are the honest edges of a client-side approach.

1. **Memory is the real ceiling on file size.** The WebCodecs path holds the input
   buffer, every encoded chunk, and the muxer output in memory at once. Practical
   limit is roughly **500MB–1GB input on desktop** and far less on mobile. A 4K
   ten-minute clip will run the tab out of memory. Fixing this properly means
   streaming demux plus a File System Access API muxer target.

2. **The fallback is realtime, and the tab must stay in front.** `MediaRecorder`
   timestamps against the wall clock, so a ten-minute clip takes ten minutes —
   and playing it faster just produces a fast-motion file. Worse, browsers pause
   background media and stop `requestAnimationFrame` in hidden tabs. This is
   observed, not theoretical: a backgrounded run fails with *"video-only
   background media was paused to save power."* There is now a stall watchdog
   that ends the export with a clear message instead of hanging forever.

3. **Browser support is uneven.**
   - WebCodecs MP4 path: Chrome/Edge 94+, Safari 16.4+. **Firefox generally falls
     back**, since its `VideoEncoder` support lags.
   - `MediaRecorder` fallback: works broadly, but yields **WebM (VP8/VP9)** rather
     than MP4 everywhere except Safari.

4. **Only ISO-BMFF is demuxable here.** MP4/M4V/MOV take the fast path. **WebM and
   MKV inputs fall back to realtime**, because there is no WebM demuxer in the
   bundle. HEVC decoding depends on OS and hardware (it worked on macOS here).
   ProRes and 10-bit sources are unreliable.

5. **Audio is passthrough-only.** It survives when it is AAC inside MP4/MOV.
   Anything else is dropped with a visible warning, or re-encoded by the recorder
   path. There are no audio filters.

6. **Browser encoders give you far less control than x264** — bitrate only, no
   CRF, no two-pass, minimal profile tuning. Quality per byte is meaningfully
   below a real encoder, and less predictable.

7. **Variable frame rate is approximated.** Nominal fps is derived from chunk
   count over duration. Per-frame timestamps are preserved so A/V sync holds, but
   a true VFR source is described as constant-rate.

8. **Everything is treated as sRGB.** HDR, BT.2020 and Display P3 sources are
   flattened. There is no HDR pipeline.

### Why not ffmpeg.wasm?

It was the obvious candidate and it lost on merit:

- **25–30MB+** of WASM before the user can export anything.
- Threaded builds need `SharedArrayBuffer`, which forces **COOP/COEP headers** and
  breaks third-party embedding.
- It is **software-only**. WebCodecs reaches the hardware encoder; measured here
  at 3.3x faster than realtime, where ffmpeg.wasm is typically several times
  *slower* than realtime for the same work.
- Decisively: the adjustments would have to be **reimplemented in ffmpeg's filter
  language**, so preview and export would be two different pieces of maths and
  would visibly disagree.

It remains a reasonable choice if you need broad container support (MKV, AVI) more
than you need speed.

### When to move video export server-side

Reach for a server when any of these are true: inputs above ~500MB, long clips
that would sit on the realtime path, Firefox users who need MP4, HDR/ProRes/10-bit
sources, or a need for deterministic quality (CRF, two-pass).

**Send the adjustments, not the pixels.** The full edit is ~15 floats — a few
hundred bytes of JSON — so the client uploads the original once (resumable upload
via tus or an S3 presigned URL), the server runs the job on a queue, and the
client polls for a signed result URL.

The one thing worth being careful about is **parity**: a naive ffmpeg filter chain
(`eq`, `colorbalance`, `curves`, `unsharp`, `vignette`) will *not* match this
shader, because the ordering and the linear-light exposure differ. Two ways to
keep them honest, in order of preference:

1. **Run the same GLSL server-side** via ffmpeg's `libplacebo` filter or a headless
   GPU worker. The shader is already isolated in one file with no DOM
   dependencies, so this is mostly plumbing, and parity is exact by construction.
2. **Port the chain to ffmpeg filters and defend it with a golden-image test** that
   renders a fixed probe through both paths and asserts the difference stays under
   a small ΔE threshold in CI.

Keep the client path as the default regardless — it is faster and more private for
the common case, and the server is the escape hatch for the tail.

## Keyboard

| Key | Action |
| --- | --- |
| `\` | Toggle before/after compare |
| `Space` | Play / pause video |
| `R` | Reset all adjustments |
| `E` | Export |
| Arrows | Nudge a focused slider (`Shift` for fine) |
| Double-click | Reset a single slider |
