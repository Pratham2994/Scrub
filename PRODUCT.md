# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who have a video file and one specific thing they need done to it — cut
thirty seconds out, make it small enough to send, turn it into a GIF, strip the
audio — and who do not want to learn ffmpeg's flag grammar to get it.

The defining trait is asymmetric: they **can read** ffmpeg's output but do not want
to **write** its input. CLAUDE.md states both halves outright — "if the user has to
know ffmpeg to use it, it has failed", and "this tool's audience can read ffmpeg
output". That is why failures surface raw stderr instead of "conversion failed", and
why the generated command is shown rather than hidden.

Distributed as public open source. Anyone who finds the repository is a user, with
no context and no way to ask the author anything, so install instructions, platform
coverage and failure messages have to stand on their own.

## Product Purpose

Turn the ten or so things people actually do with ffmpeg into a GUI, and make the
command itself the thing you take away.

Success is a ninety-second visit: open it, drop a file, pick an operation, see
exactly what will run, run it, leave. A user who finishes having also learned the
command has got more than they came for, which is the point of showing it.

## Positioning

Two claims a neighbouring ffmpeg wrapper could not truthfully copy:

1. **The displayed command is the executed command.** Not a rendering of the
   intent, not a reconstruction — one pure function produces the `string[]` that the
   preview shows and that `spawn` receives. Wrappers built on `fluent-ffmpeg` cannot
   say this, because that library's entire purpose is to hide the command.
2. **The operation list is closed.** Every other wrapper grows toward exposing all
   of ffmpeg, at which point the user needs to know ffmpeg again and the wrapper has
   no reason to exist. Scrub's escape hatch is the editable command bar, not a
   settings panel.

The design position is narrower and equally deliberate: Scrub is light where every
other video tool is dark, because it is a utility you open for ninety seconds beside
a browser, not a colour-grading suite you sit in for eight hours.

## Operating Context

Runs entirely on the user's own machine. They start it from a terminal, use it in a
browser tab next to whatever they were already doing, and close it.

It is a front-end, not a bundle: ffmpeg and ffprobe must already be installed, and
the server refuses to start without them rather than failing at Run.

Because it is a browser app, the file makes a round trip — uploaded into a local
working directory, probed, processed, and downloaded back out. This is accepted as
permanent, not a staging post toward a desktop shell. It has consequences that are
product facts rather than implementation details: large files take real time to copy
before anything begins, the working directory must be swept on a TTL, and output
arrives in the browser's download location rather than next to the source file.

The server binds to loopback and must never be exposed on a network. An editable
command bar reachable over HTTP is remote code execution; that is inherent to the
feature, not a defect to be hardened away.

## Capabilities and Constraints

Eleven operations, closed. Video: trim (fast and precise), compress, convert,
resize, GIF, extract audio, mute, replace audio. Audio: convert, trim, normalise
loudness. Deferred with reasons in `docs/OPERATIONS.md`: concat, rotate, subtitle
burn-in, batch.

- ffmpeg is spawned as an argument array, never through a shell.
- Progress is read from ffmpeg's machine-readable stdout stream, never from parsing
  its human-readable log.
- Browsers cannot decode HEVC, which is the default for iPhone recordings. The
  operation still works; only the in-page preview does not, and the UI has to say
  which of the two has failed.
- Fast trim cuts on keyframes. The result can begin earlier and run longer than
  asked. Users read "fast" as "less accurate", not as "longer than I requested", so
  the cost is stated rather than implied.
- The fast/precise trade is never chosen on the user's behalf.

**Terminology:** the operations are named with verbs the user already has — Trim,
Compress, Convert, Resize, GIF, Extract audio, Mute, Replace audio, Normalise
loudness. Not "transcode", not "remux", not "encode".

## Brand Commitments

Named **Scrub**, after the interaction that justifies the project: dragging along a
timeline to find a frame.

Voice: specific, unapologetic, British spelling. Buttons say what happens and
results echo them — "Run" produces "Done — 4.2 MB, 12s", never "Processing…" and
never "Submit". Errors do not apologise and do not generalise; an ffmpeg failure is
reported as what ffmpeg printed, with its exit code.

Deliberately not used: `fluent-ffmpeg`, three.js, any state library heavier than
Zustand, Python.

## Evidence on Hand

- `docs/OPERATIONS.md` — the command, flag reasoning and traps for all eleven
  operations. Authoritative for anything touching `buildArgs`.
- `shared/src/build-args.test.ts` — argv snapshots. A refactor cannot silently
  change what gets executed.
- Self-hosted Switzer and Commit Mono in `client/public/fonts`, with licences
  recorded.

Absent, and not to be invented: there are no users yet, no benchmarks, no
testimonials, no published release, and no adoption of any kind.

## Product Principles

1. **The command is the product.** If the preview and the execution could ever
   disagree, the disagreement is the bug — no matter how much nicer the preview
   looks.
2. **Closed list, open escape hatch.** New capability goes through the editable
   command bar, never through a new control. A tenth checkbox is the failure mode.
3. **Never decide a trade-off the user can see.** Fast versus precise, `-shortest`
   versus padding: name the cost and let them pick.
4. **Fail loudly and early, in the user's language.** The server refuses to boot
   without ffmpeg; ffmpeg's own stderr is the error message. A generic apology is
   worse than a stack trace for this audience.
5. **Only what comes from the file earns screen space.** The waveform, the filmstrip
   and the live command are derived from the user's data. Anything that is not,
   and that does not change what they can do, is cut.

## Accessibility & Inclusion

WCAG AA against each element's own surface, keyboard reachable throughout with focus
visible everywhere.

The keyboard surface is a primary interface here rather than a fallback — space to
play and pause, `[` and `]` to set in and out points, arrows to nudge by a frame and
shift-arrows by a second. Landing on an exact frame with a mouse is the task Scrub
exists to make less painful, and for many users the keyboard is the only way to do
it precisely.

Motion respects `prefers-reduced-motion` by dropping to opacity-only.
