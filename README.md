# Scrub

A local ffmpeg GUI. Drop a file in, pick an operation, get a file out. It runs on
your own machine and nothing goes to the internet.

Most ffmpeg front-ends just expose ffmpeg's flags, which means you still have to
know ffmpeg. Scrub covers the things people actually do with it, across twenty-four
operations.

Three things make it worth using instead of a terminal:

- **It can hit a file size.** Pick Discord, WhatsApp or an email attachment and
  Scrub works out the bitrate from the limit and the length, then encodes in two
  passes to get under it. Every other compression control asks how good you want
  it and gives you whatever size that takes, which is no help when something has a
  hard limit.
- **The exact command is on screen before it runs**, and you can copy or edit it.
  One function builds the argv that the preview shows and that `spawn` executes, so
  they can't drift apart.
- **Trimming is done by dragging over real frames** from your file, which is the
  part that's genuinely painful to do by hand. Crop works the same way.

The operation list is closed on purpose. Anything not on it goes through the
editable command bar.

## What it does

Video, on one file:

| Operation     | What it does                                                               |
| ------------- | -------------------------------------------------------------------------- |
| Trim          | Cut a section out. Drag handles over real frames, or type the timecodes.   |
| Compress      | Smaller file, at a quality you choose.                                     |
| Fit a size    | Come in under a hard limit. Two passes, budget worked out from the length. |
| Convert       | mp4, webm, mkv or mov. Remuxes instead of re-encoding when it can.         |
| Resize        | Scale to a target width, aspect and even dimensions kept.                  |
| Crop          | Drag a rectangle out of the picture.                                       |
| Speed         | Faster or slower, sound stretched to match so it stays in step.            |
| GIF           | Two-pass palette, so it does not come out banded.                          |
| Extract audio | Pull the sound out as mp3, aac, opus, wav or flac.                         |
| Mute          | Drop the audio, copy the picture.                                          |
| Replace audio | Swap in a different track, ending at the shorter of the two.               |
| Fade          | Fade picture and sound in and out.                                         |
| Loop          | Play the whole file again, up to sixteen times. No re-encode.              |
| Volume        | Louder or quieter, picture untouched.                                      |

Video, across several files:

| Operation | What it does                                                                          |
| --------- | ------------------------------------------------------------------------------------- |
| Merge     | Join up to four clips, with a crossfade between them, and optional fades on the ends. |
| Add music | Put a song under a clip, with the original and the music balanced separately.         |
| Watermark | Stamp an image over the picture. Nine positions, adjustable opacity.                  |

Audio:

| Operation | What it does                                                             |
| --------- | ------------------------------------------------------------------------ |
| Convert   | mp3, aac, opus, wav or flac.                                             |
| Trim      | Cut a section out. Sample accurate, so there is no fast/precise choice.  |
| Loudness  | Two-pass normalise to a LUFS target, broadcast or streaming.             |
| Merge     | Join up to twelve songs with a crossfade, which is how a mix gets built. |
| Fade      | Fade the sound in and out. On a video the picture is copied untouched.   |
| Loop      | Play the whole file again, up to sixteen times. No re-encode.            |
| Volume    | Louder or quieter. On a video the picture is copied untouched.           |

There is also **Save this frame** on the video well: the frame under the playhead,
written out as a lossless PNG. It is a button rather than an operation, because the
frame you want is the one already on screen.

## Fitting a size

Fit a size is the operation that answers a different question from every other
compression control. They ask how good you want it. A platform limit asks how big.
Those are not the same question, and only the second one tells you whether the
upload will be refused.

Scrub carries the limits for the places that reject a file outright, each with the
date it was last checked, because they move: Discord, WhatsApp, an email
attachment, Discord Nitro Basic, and X. If your copy of the file lands a little
under the number, that is deliberate. Container overhead can fall on the wrong side
of a hard limit, and a file refused after you waited for the upload is worse than
one that came out slightly small. For anywhere else, type the number yourself.

If the target cannot hold the length, Scrub says so and tells you roughly how long
would have fitted. Below about 100 kbit/s h264 stops looking like a picture, so
there is no point encoding a smear that happens to be the right size.

## What this is

Scrub isn't a website you visit. It's a small program you run on your own machine,
which then opens in your browser. There's no Scrub server anywhere, no account, and
nothing goes to the internet. The "upload" is your file being copied into a working
folder on your own disk.

So ffmpeg has to be installed on the machine running Scrub, which is yours. Scrub
doesn't bundle it and won't download it. It finds the one you installed and runs
it, which is the point: the command it shows you is one you could paste into your
own terminal and get the same result.

Don't put Scrub on a shared server. Everything inverts if you do, and the files,
the ffmpeg and the disk all become the server's. See
[A note on the network](#a-note-on-the-network) for why that's unsafe rather than
just unsupported.

## Requirements

- Node 22 or newer
- ffmpeg and ffprobe on your PATH

### Installing ffmpeg

```sh
# macOS
brew install ffmpeg

# Windows
winget install Gyan.FFmpeg
# or: choco install ffmpeg-full
# or: scoop install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg
```

On Windows, open a new terminal afterwards so the updated PATH is picked up. If
you're still in the old one, Scrub also looks in the standard winget, scoop and
chocolatey locations, so it usually finds the binaries anyway.

Scrub spawns the executable directly rather than through a shell, so a `.bat` or
`.cmd` wrapper won't work. It needs the real binary. If yours lives somewhere
unusual, point Scrub at it:

```sh
SCRUB_FFMPEG_PATH=/full/path/to/ffmpeg
SCRUB_FFPROBE_PATH=/full/path/to/ffprobe
```

The server checks both on boot and refuses to start if either is missing, printing
the install command for your platform. "Nothing happens when I press Run" is a
miserable thing to debug an hour later.

## Running it

Install ffmpeg first, then:

```sh
git clone https://github.com/Pratham2994/Scrub.git
cd Scrub
npm install
npm run dev
```

Open <http://localhost:5173> and drop a file on it.

`npm install` takes a minute or two and pulls in about 220 MB of `node_modules`.
That's all the setup there is. No config file, no `.env`, no account, no key. Press
`Ctrl+C` in the terminal to stop it; nothing keeps running afterwards.

### Why `npm run dev` and not a build

It's not a placeholder for a production mode that's coming later. Scrub is
something you start when you want it and close a minute later, and on loopback the
difference between a dev server and a bundle is about half a second of load time.
There's no deployment, no second machine and nothing secret, so a build step would
be one more thing to keep working for no benefit you'd notice.

There is one real cost. The dev server restarts when a file under `server/`
changes, and a restart kills any encode in progress, because jobs are held in
memory. That matters if you're editing the code or pulling changes while a long
export runs. If you're only using Scrub, it won't come up.

`npm run build` still exists, but nothing runs its output. It's in `verify` as a
check that the client still bundles, which typechecking alone doesn't prove.

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | How you run Scrub. Client, server, and the shared watch |
| `npm run typecheck` | TypeScript across every workspace                       |
| `npm run lint`      | ESLint                                                  |
| `npm run test`      | Vitest, for `shared` and `server`                       |
| `npm run test:e2e`  | Playwright, against a real ffmpeg                       |
| `npm run build`     | Bundling check. Nothing runs the output                 |
| `npm run verify`    | All of the above, in order                              |

The end-to-end tests need a browser binary as well:

```sh
npx playwright install chromium
npm run test:e2e
```

## A note on the network

Scrub binds to `127.0.0.1` and must never be exposed on a network.

The command bar is editable. An editable command bar plus a reachable HTTP endpoint
is remote code execution, and that's what the feature is rather than a bug to
harden around later. Don't change the bind address, don't put it behind a reverse
proxy, and don't forward the port.

Loopback on its own isn't the whole defence, because it does nothing about your own
browser: any page you have open can `POST` to `127.0.0.1`. So Scrub also checks the
`Host` and `Origin` headers, and requires a custom request header on everything
except the health check. That forces a CORS preflight, which a cross-origin page
can't satisfy.

Uploaded files and outputs live in `.tmp/`, which is gitignored and swept on a TTL
(six hours by default) on boot and on an interval. Video is large and nobody comes
back for yesterday's export.

## Layout

```
client/   React SPA. One workspace rather than multiple pages, since the loaded
          file is the state. Routes are /op/:name for deep-linking, but it is one
          layout with a swapping centre panel.

server/   POST /upload       multipart -> tmp, ffprobe, returns { id, meta }
          GET  /meta/:id     probed duration, streams, codecs, dimensions
          GET  /recent       files still in the working folder
          POST /run          validates with zod, buildArgs, spawn
          GET  /jobs         what is running, so a reload can rebuild the queue
          GET  /run/:id/events   SSE progress, one stream per job
          DELETE /run/:id    cancel
          GET  /source/:id   the working copy, for <video>
          GET  /download/:id the result
          GET  /filmstrip/:id, /waveform/:id   drawn by ffmpeg, cached
          GET  /storage      what is in the working folder; DELETE clears it
          GET  /health       ffmpeg + ffprobe version check

shared/   Operation types and the buildArgs function. Imported by both.
```

## Status

Done. All twenty-four operations are built, and each has been run through real
ffmpeg with the output probed back.

Upload, probe, preview, run with live progress, cancel, compare against the
original and save all work. Trim and GIF scrub against a filmstrip of real frames
from your file with the waveform underneath, and an audio file gets the waveform as
its whole timeline. The command bar shows every pass of a multi-pass operation and
can be edited directly. What you type is checked for the mistakes that cost an
encode, and a flag Scrub doesn't recognise is passed through to ffmpeg rather than
refused.

An operation that can't apply to the loaded file says so and points at the one that
does, instead of letting ffmpeg silently succeed at nothing. HEVC files, which
browsers can't decode, explain that it's the preview that failed and not the
operation.

Encodes queue instead of competing for the CPU. Start one, set the next up while it
runs, and both show in a strip above the command bar with their own progress, the
time remaining and cancel. The queue survives a reload, because the jobs are the
server's rather than the page's. A finished result can become the next source with
one button, so trim then compress doesn't mean saving a file and dropping it back
in, and the name carries the whole chain: `clip-trim-0s-2s-compress-crf23.mp4`.
Settings are remembered between visits. The file is not.

Appearance has four choices, not two. Light and dark, following the system or
picked by hand, and **Tube**, which re-racks the whole app as a green phosphor CRT:
the rail becomes one horizontal strip, the command bar becomes a prompt with a
block cursor, and the layout and radii change with it. It is a different room
rather than a darker one.

Not built, on purpose: rotate, subtitle burn-in and batch. Rotate is usually a
metadata change rather than a filter, subtitles need libass and font resolution,
and batch is a different shape of application. All three are reachable through the
command bar, which is what it's for.

### Tests

`npm run verify` runs typecheck, lint, formatting, the bundling check and three
test suites.

| Suite    | Count | What it covers                                       |
| -------- | ----- | ---------------------------------------------------- |
| `shared` | 207   | `buildArgs` argv snapshots, availability, the linter |
| `server` | 64    | The tmp sweeper, the store, the CSRF guard, loudnorm |
| `e2e`    | 67    | Real flows against real ffmpeg, in a real browser    |

There is also a contrast check on every palette, in every theme, so a colour cannot
drop below its accessibility floor without failing the build.

The end-to-end tests aren't mocked. The whole product is that the command Scrub
shows is the command that runs, and a suite that stubbed the server out would be
testing the half of that which was never in doubt.
