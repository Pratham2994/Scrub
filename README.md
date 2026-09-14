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

```sh
npm install
npx playwright install chromium   # only needed to run the end-to-end tests
npm run dev
```

That starts the API on `http://127.0.0.1:5174` and the client on
`http://localhost:5173`.

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Client, server, and the shared package's watch build |
| `npm run build`     | Production build of all three workspaces             |
| `npm run typecheck` | TypeScript across every workspace                    |
| `npm run lint`      | ESLint                                               |
| `npm run test`      | Vitest — `buildArgs` argv snapshots                  |
| `npm run test:e2e`  | Playwright                                           |
| `npm run verify`    | All of the above                                     |

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

server/   POST /upload    multipart -> tmp, ffprobe, returns { id, meta }
          GET  /meta/:id  probed duration, streams, codecs, dimensions
          POST /run       validates with zod, buildArgs, spawn, SSE progress
          GET  /download/:id
          GET  /health    ffmpeg + ffprobe version check

shared/   Operation types and the buildArgs function. Imported by both.
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — the rules, and what is non-negotiable
- [`DESIGN.md`](DESIGN.md) — tokens, layout, and what carries the identity
- [`PRODUCT.md`](PRODUCT.md) — who it is for and what it is
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — every operation's command, the
  reasoning behind each flag, and the traps. Read before touching `buildArgs`.

## Status

Working. Upload, probe, preview, run with live progress, cancel, and download all
function, and every one of the eleven operations produces a real command.

Trim has full controls — a range scrubber, typed timecodes, and the fast/precise
toggle. The other ten are reachable through the editable command bar, which
lints what you type against the traps in `docs/OPERATIONS.md`, but do not have
their own control panels yet. The filmstrip and waveform are not built.
