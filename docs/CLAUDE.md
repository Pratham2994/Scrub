# Scrub

A local ffmpeg GUI. Drop a file in, pick one of a handful of operations, get a file out.

Not a wrapper that exposes ffmpeg's flags. If the user has to know ffmpeg to use it, it has failed.

## Non-negotiables

1. **The command is the product.** Every operation shows the exact ffmpeg command before it runs, copyable and editable. Never generate the displayed command separately from the executed one. One pure function, `buildArgs()`, produces the `string[]` that both the preview and `spawn()` consume.
2. **Never shell out.** Always `spawn('ffmpeg', argsArray)`. Never `exec`, never string interpolation into a shell, never `shell: true`.
3. **Loopback only.** The server binds `127.0.0.1`. The command bar is editable, so exposing this on a network is remote code execution. Do not change the bind address.
4. **No feature creep.** The operation list below is closed. Anything else goes through the editable command bar.

## Stack

- **Client** - Vite, React 19, TypeScript, Tailwind v4, shadcn/ui, Motion, Zustand, Wavesurfer.js
- **Server** - Node 22, Express 5, TypeScript, multer, zod, SSE for progress
- **Test** - Vitest on `buildArgs`, Playwright for end-to-end flows
- npm workspaces, `npm run dev` starts both

Deliberately not used: `fluent-ffmpeg` (it hides the command, which is the feature), three.js, any state library heavier than Zustand, Python.

## Operations

Video: trim (fast/precise), compress, fit a size, convert, resize, crop, speed, GIF,
extract audio, mute, replace audio, merge, add music, watermark, fade, loop, volume.
Audio: convert, trim, normalise loudness, merge, fade, loop, volume.

The list is closed, and closed does not mean frozen - it means it grows only for something people already do, never to expose more of ffmpeg. Fit a size was added because "get this under 10 MB" is the most common video request there is and compress could not answer it. Speed and crop sit in the same everyday category as trim and resize. The merge suite arrived because joining clips, mixing songs, music under a video, a logo stamp, fades, loops and volume are what people do with more than one file, and doing them by hand is where most people give up and open an editor. A tenth checkbox inside an operation is still the failure mode.

Details, exact commands, and the traps in each live in `docs/OPERATIONS.md`. Read that before touching `buildArgs`.

Deferred with reasons in that file: rotate, subtitle burn-in, batch.

## Architecture

```
client/   React SPA. One workspace, not multiple pages - the loaded file is
          the state. Routes are /op/:name for deep-linking, but it is one
          layout with a swapping centre panel.

server/   POST /upload    multipart -> tmp, ffprobe, returns { id, meta }
          GET  /meta/:id  probed duration, streams, codecs, dimensions
          POST /run       validates with zod, buildArgs, spawn, SSE progress
          GET  /download/:id
          GET  /health    ffmpeg + ffprobe version check

shared/   Operation types and the buildArgs function. Imported by both.
```

## Rules that are easy to get wrong

- **Progress** comes from `-progress pipe:1 -nostats` on stdout, divided against the ffprobe duration. Do not parse the human-readable stderr log.
- **Scaling** uses `-2`, never `-1`. libx264 requires even dimensions and `-1` can produce an odd number, which fails the encode.
- **Converting containers is not remuxing.** mp4 to webm needs `libvpx-vp9` and `libopus`. There is a codec map; use it.
- **GIF is two passes** (`palettegen` then `paletteuse`). Single-pass GIF looks visibly worse and is what every bad wrapper does.
- **loudnorm is two passes.** Measure with `print_format=json`, parse the JSON from stderr, feed the measured values back into the second pass.
- **`-ss` before `-i`** seeks to the nearest keyframe and is fast but not frame-accurate. After `-i` it is accurate but re-encodes. The trim UI exposes this as a toggle; do not pick for the user.
- **Browsers cannot preview HEVC**, which is the default on iPhone recordings. Detect the codec on upload and show a clear message where the preview would be. The operation still works; only the preview does not.
- **Multi-input operations** carry upload ids in the operation; the server resolves them into `io.secondaryInputs` so buildArgs stays pure. Streams are copied unless ffmpeg forces a re-encode; forced re-encodes use the codec map and default to crf 20 / aac 192k.
- **Clean the tmp directory.** Video files are large. TTL sweep on an interval and on boot.

## Errors

When ffmpeg exits non-zero, surface the last ~15 lines of its stderr to the client. A generic "conversion failed" is useless and this tool's audience can read ffmpeg output.

The server refuses to start if `ffmpeg -version` or `ffprobe -version` fails, and prints install instructions for the platform.

## Testing

`buildArgs` is a pure function with no I/O, so every operation and parameter combination is a snapshot test. A refactor must not silently change what gets executed. This is the highest-value test surface in the project.

Playwright covers the flows end-to-end with a small fixture clip committed to the repo.

## Style

- TypeScript strict. No `any`.
- No default exports except React pages.
- Errors are values on the server boundary; do not throw across the SSE stream, send an error event.
- Comments explain why, not what. Most ffmpeg flag choices need a why.
