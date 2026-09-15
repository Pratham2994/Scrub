# Scrub

A local ffmpeg GUI. Drop a file in, pick one of a handful of operations, get a file
out.

Most ffmpeg front-ends expose ffmpeg's flags, which means you still have to know
ffmpeg. Scrub is a GUI for the ten or so things people actually do with it. Two
things make it worth using over a terminal:

- **The exact command is always visible before it runs**, copyable and editable. One
  pure function produces the argv that the preview shows and that `spawn` executes —
  they cannot drift apart.
- **The trim scrubber** removes the genuinely painful part of trimming by hand:
  finding the frame.

Everything else is a convenience wrapper, and the operation list is closed on
purpose.

## How this works, and what you need

Scrub is **not a website you visit**. It is a small program you run on your own
machine, which then opens in your browser. There is no Scrub server anywhere, no
account, and nothing is uploaded to the internet — the "upload" is your file being
copied into a working folder on your own disk, a few centimetres from where it
already was.

That means **ffmpeg has to be installed on the machine running Scrub**, which is
your machine. Scrub does not bundle ffmpeg and does not download it: it finds the
one you installed and runs it, which is the whole point. The command it shows you
is a command you could paste into your own terminal and get the same result.

If you ever put Scrub on a shared server, everything inverts — the files, the
ffmpeg, and the disk all become the server's. Do not do that; see
[A note on the network](#a-note-on-the-network) for why it is genuinely unsafe
rather than merely unsupported.

## Requirements

- **Node 22 or newer**
- **ffmpeg and ffprobe on your PATH** — Scrub does not bundle them

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
you're in an old terminal, Scrub also searches the standard winget, scoop and
chocolatey install locations directly, so it usually finds the binaries anyway.

Scrub spawns the executable directly, never through a shell, so a `.bat` or `.cmd`
wrapper will not work — it needs the real binary. If yours lives somewhere unusual,
point Scrub at it:

```sh
SCRUB_FFMPEG_PATH=/full/path/to/ffmpeg
SCRUB_FFPROBE_PATH=/full/path/to/ffprobe
```

The server checks both binaries on boot and refuses to start if either is missing,
printing the install command for your platform. That is deliberate: "nothing happens
when I press Run" is a miserable thing to debug an hour later.

## Running it

Three commands from nothing to a working app. Install ffmpeg first, from the
section above.

```sh
git clone https://github.com/Pratham2994/Scrub.git
cd Scrub
npm install
npm run dev
```

Then open **<http://localhost:5173>** in a browser and drop a file on it.

`npm install` takes a minute or two and pulls in about 220 MB of `node_modules`;
that is the whole toolchain, and it is all of the setup there is. There is no
configuration file to write, no `.env`, no account, and no key. If ffmpeg is
missing the server says so on boot and prints the install command for your
platform rather than failing later at Run.

To stop it, press `Ctrl+C` in that terminal. Nothing keeps running afterwards.

### Why `npm run dev` is the way to run it

It is not a placeholder for a production mode that is coming later. Scrub is a
program you start when you want it and close ninety seconds afterwards, and on
loopback the difference between a dev server and a bundle is about half a second
of load time. There is no deployment, no second machine, and nothing secret, so a
build step would add a thing to keep working in exchange for nothing you would
notice.

The one real cost: the dev server restarts when a file under `server/` changes,
and a restart kills any encode in progress, because jobs are held in memory. That
matters if you are editing the code or pulling changes while a long export runs.
If you are only using Scrub, it never happens.

`npm run build` still exists, but nothing runs its output — it is in `verify` as a
check that the client still bundles, which typechecking alone does not prove.

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | **How you run Scrub.** Client, server, and the shared watch |
| `npm run typecheck` | TypeScript across every workspace                           |
| `npm run lint`      | ESLint                                                      |
| `npm run test`      | Vitest — `buildArgs` snapshots, and the server              |
| `npm run test:e2e`  | Playwright — real flows against a real ffmpeg               |
| `npm run build`     | Bundling check. Nothing runs the output                     |
| `npm run verify`    | All of the above, in order                                  |

Running the end-to-end tests needs a browser binary as well:

```sh
npx playwright install chromium
npm run test:e2e
```

## A note on the network

**Scrub binds to `127.0.0.1` and must never be exposed on a network.**

The command bar is editable. Editable command bar plus reachable HTTP endpoint
equals remote code execution — that is not a bug to be hardened around later, it is
what the feature is. Do not change the bind address, do not put it behind a reverse
proxy, and do not forward the port.

Loopback alone is not the whole defence, because it does nothing about your own
browser: any page you have open can `POST` to `127.0.0.1`. Scrub therefore also
validates the `Host` and `Origin` headers and requires a custom request header on
everything except the health check, which forces a CORS preflight that a
cross-origin page cannot satisfy.

Uploaded sources and encoded outputs live in `.tmp/`, which is gitignored and swept
on a TTL (six hours by default) on boot and on an interval. Video is large; nobody
comes back for yesterday's export.

## Layout

```
client/   React SPA. One workspace, not multiple pages — the loaded file is the
          state. Routes are /op/:name for deep-linking, but it is one layout with
          a swapping centre panel.

server/   POST /upload       multipart -> tmp, ffprobe, returns { id, meta }
          GET  /meta/:id     probed duration, streams, codecs, dimensions
          POST /run          validates with zod, buildArgs, spawn
          GET  /run/:id/events   SSE progress, one stream per job
          DELETE /run/:id    cancel
          GET  /source/:id   the working copy, for <video>
          GET  /download/:id the result
          GET  /filmstrip/:id, /waveform/:id   drawn by ffmpeg, cached
          GET  /storage      what is in the working folder; DELETE clears it
          GET  /health       ffmpeg + ffprobe version check

shared/   Operation types and the buildArgs function. Imported by both.
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — the rules, and what is non-negotiable
- [`DESIGN.md`](DESIGN.md) — tokens, layout, and what carries the identity
- [`PRODUCT.md`](PRODUCT.md) — who it is for and what it is
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — every operation's command, the
  reasoning behind each flag, and the traps. Read before touching `buildArgs`.

## Status

Complete, against the operation list in [`CLAUDE.md`](CLAUDE.md), which is closed
on purpose. All eleven operations are built and each has been run through real
ffmpeg with the output probed back.

Upload, probe, preview, run with live progress, cancel, compare against the
original, and save all work. Trim and GIF scrub against a filmstrip of real frames
from your own file, with the waveform drawn underneath; an audio file gets the
waveform as its whole timeline. The command bar shows every pass of a multi-pass
operation and can be edited directly — what you type is linted against the traps
in `docs/OPERATIONS.md`, and a flag Scrub does not recognise is passed through to
ffmpeg rather than refused.

An operation that cannot apply to the loaded file says so and points at the one
that does, rather than letting ffmpeg silently succeed at nothing. HEVC files,
which browsers cannot decode, explain that the preview is what failed and not the
operation.

Deliberately not built: concat, rotate, subtitle burn-in and batch, each with its
reasoning in [`docs/OPERATIONS.md`](docs/OPERATIONS.md). They are reachable through
the command bar, which is what it is for.

### Tests

`npm run verify` runs all of it: typecheck, lint, formatting, the bundling check,
and three test suites.

| Suite    | Count | What it covers                                       |
| -------- | ----- | ---------------------------------------------------- |
| `shared` | 122   | `buildArgs` argv snapshots, availability, the linter |
| `server` | 57    | The tmp sweeper, the store, the CSRF guard, loudnorm |
| `e2e`    | 41    | Real flows against real ffmpeg, in a real browser    |

The end-to-end tests are deliberately not mocked. The whole product is "the
command Scrub shows is the command that runs", and a suite that stubbed the server
out would be testing the half of that claim which was never in doubt.
