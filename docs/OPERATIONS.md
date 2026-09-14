# Operations

The reference for `buildArgs`. CLAUDE.md says to read this before touching that
function; this is that file.

One entry per operation in the closed list. Each says what the command is, why the
flags are the ones they are, and what goes wrong if you reach for the obvious
alternative. All eleven are implemented. Each entry is the reasoning behind its flags, and
the trap it exists to avoid.

## The contract

```ts
buildArgs(op: Operation, meta: ProbeResult, io: CommandIo): CommandPlan;
```

`CommandPlan` is `{ passes: CommandPass[] }`, and a `CommandPass` is
`{ argv, label, outputDurationSec, capture? }`.

Three things about this shape are load-bearing:

**It returns passes, not a single argv.** GIF and loudnorm are genuinely two
invocations. A single `string[]` would have forced those two operations to build
their commands somewhere other than `buildArgs`, which is exactly the divergence
between the previewed command and the executed one that CLAUDE.md's first
non-negotiable exists to prevent.

**`argv` is complete and real.** It carries the actual tmp paths and the transport
flags, because it is handed to `spawn` untouched. The command bar shortens paths to
basenames for reading and dims the transport flags, but that is rendering — `Copy`
yields the true command, and nothing is appended downstream.

**`outputDurationSec` is the progress denominator.** Not the source duration. See
[Progress](#progress).

`buildArgs` is pure: no I/O, no clock, no randomness. That is what makes every
operation and parameter combination a snapshot test, and CLAUDE.md is right that
this is the highest-value test surface in the project.

## Transport flags

Every pass begins with `TRANSPORT_ARGS`:

```
-hide_banner -nostdin -nostats -progress pipe:1
```

and ends its options with `-y` before the output path.

- `-nostdin` — without it ffmpeg reads stdin and can swallow keystrokes or block.
- `-nostats -progress pipe:1` — machine-readable progress on **stdout**. The
  human-readable stderr log is not a progress source; it is rate-limited, carriage
  returned, and format-unstable.
- `-y` — output ids are freshly minted, but with `-nostdin` a collision would hang
  rather than prompt.

They are in `argv` rather than prepended by the server so that what the bar shows is
what runs. The bar draws them in `--token-transport` and scrolls past them by
default, so the operation leads.

## Progress

```
out_time_us=12400000
```

Parse `out_time_us` and divide by the pass's `outputDurationSec`.

Two traps:

1. **`out_time_ms` is microseconds.** Long-standing ffmpeg misnomer. Use
   `out_time_us` and there is nothing to get wrong.
2. **Do not divide by the source duration.** When `-ss` is an input option, ffmpeg
   restarts output timestamps at zero. A 30-second trim of a 10-minute file reports
   `out_time` running 0 → 30, not 720 → 750. Dividing by 612 would peg that encode
   at 5% and leave it there. `outputDurationSec` on the pass is the right
   denominator and `buildArgs` already knows it.

---

## Video

### Trim — fast ✅

```
ffmpeg -ss 12.4 -i in.mp4 -t 35.7 -c copy -avoid_negative_ts make_zero -y out.mp4
```

`-ss` **before** `-i` is an input option: ffmpeg seeks the demuxer instead of
decoding up to the mark. That is the entire point of the fast path, and also its
cost — with `-c copy` the cut can only land on a keyframe, so the output may begin
_earlier_ than asked and run _longer_. Users read "Fast" as "less accurate"; they do
not expect "longer than I asked for". The UI has to say so.

`-t` not `-to`. `-t` is unambiguously the duration of the output. `-to` combined
with an input-side `-ss` is the exact pairing whose meaning people get wrong. The
user thinks in start/end; the conversion to a duration happens in `buildArgs`, once,
where a test pins it.

`-avoid_negative_ts make_zero` — a stream copy starting mid-stream carries the
source's timestamps, and the first packet can land before zero. Some players render
that as a frozen opening frame.

End is clamped to `meta.durationSec`: a scrub handle dragged to the far right can
land a hair past the probed duration through float accumulation, and the displayed
command should say where the cut actually ends.

### Trim — precise ✅

```
ffmpeg -i in.mp4 -ss 12.4 -t 35.7 -c:v libx264 -crf 18 -preset veryfast -c:a copy -y out.mp4
```

`-ss` **after** `-i` is an output option: frame-accurate, because ffmpeg decodes to
the mark and re-encodes from there. Slower and lossy. Do not pick fast or precise for
the user — the trim UI exposes it as a toggle, and states what each one costs.

CRF 18 because this is a cut, not a compression: the user asked for a different
length, not a smaller file. `veryfast` for the same reason — the point is to get
the cut, not to squeeze out the last few percent of size.

Audio can usually still be `-c:a copy`. Re-encoding it as well costs quality for no
benefit when only the video needed cutting.

### Compress ✅

```
ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k -movflags +faststart -y out.mp4
```

CRF, not a target bitrate: the user wants "smaller" and does not have a bitrate
budget in mind. 18 is near-lossless, 23 default, 28 visibly soft. `-preset` trades
encode time for file size at the same quality — it is not a quality control, which
is worth saying in the UI because everyone assumes it is.

`+faststart` moves the moov atom to the front so the file starts playing before it
has fully downloaded. Costs a second pass over the output.

### Convert ✅

**Converting a container is not remuxing.** There is a codec map and it must be
used:

| Target | Video        | Audio     |
| ------ | ------------ | --------- |
| `mp4`  | `libx264`    | `aac`     |
| `webm` | `libvpx-vp9` | `libopus` |
| `mkv`  | `libx264`    | `aac`     |
| `mov`  | `libx264`    | `aac`     |

`mkv` accepts nearly anything, so if the source codecs are already compatible,
`-c copy` is correct and instant. mp4 → webm is never a copy.

### Resize ✅

```
ffmpeg -i in.mp4 -vf scale=1280:-2 -c:a copy -y out.mp4
```

**`-2`, never `-1`.** libx264 requires even dimensions. `-1` preserves the aspect
ratio exactly and can produce an odd number, which fails the encode. `-2` rounds to
the nearest even number. The zod schema also constrains the requested width to a
multiple of 2, because an odd _width_ would break it just as surely.

### GIF — two passes ✅

```
pass 1: ffmpeg -i in.mp4 -vf fps=12,scale=480:-2:flags=lanczos,palettegen -y palette.png
pass 2: ffmpeg -i in.mp4 -i palette.png -lavfi fps=12,scale=480:-2:flags=lanczos[x];[x][1:v]paletteuse -y out.gif
```

Single-pass GIF uses a fixed 216-colour web palette and looks visibly worse. It is
what every bad wrapper does. `palettegen` derives an optimal 256-colour palette from
the actual frames; `paletteuse` then maps against it.

The filter chain must be **identical** in both passes or the palette is built from
different pixels than it is applied to.

`palette.png` goes in `io.workDir` and is swept with everything else.

Pass 1's `outputDurationSec` is `null` — it produces a single PNG, not a timeline.

### Extract audio ✅

```
ffmpeg -i in.mp4 -vn -acodec copy -y out.m4a
```

`-vn` drops video. Prefer `-acodec copy` when the requested format already matches
the source codec — an AAC track out of an mp4 needs no re-encode, and re-encoding it
to mp3 "because the user picked mp3" loses quality for nothing. Fall back to a real
encoder when the formats genuinely differ.

### Mute ✅

```
ffmpeg -i in.mp4 -an -c:v copy -y out.mp4
```

`-c:v copy` matters: muting must never re-encode the video.

### Replace audio ✅

```
ffmpeg -i in.mp4 -i new.m4a -map 0:v:0 -map 1:a:0 -c:v copy -shortest -y out.mp4
```

`-map` is required; without it ffmpeg's default stream selection picks one stream per
type from whichever input it prefers and silently ignores the other file.

`-shortest` ends at whichever track runs out first. The alternatives — padding the
audio or letting video run silent — are both decisions the user should make, so
surface it rather than baking it in.

The replacement track arrives as its own upload id; the server resolves it to a path.

## Audio

### Convert ✅

```
ffmpeg -i in.wav -c:a libmp3lame -b:a 192k -y out.mp3
```

Encoder by target: `libmp3lame` / `aac` / `pcm_s16le` (wav) / `flac` / `libopus`.
Bitrate is meaningless for `wav` and `flac` — they are uncompressed and lossless
respectively, so the control should disappear rather than be ignored.

### Trim

Same argument as video trim, minus the keyframe problem. Audio codecs have far
smaller frames, so `-c copy` is close to sample-accurate and there is no
fast/precise decision to force on anyone.

### Loudness — two passes, with a data dependency ✅

```
pass 1: ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
pass 2: ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true -y out.wav
```

This is the only operation where a pass needs data from the one before it, which is
what `CommandPass.capture: 'loudnorm-json'` marks. Pass 1 measures and prints a JSON
block **on stderr**; parse it and feed the five measured values into pass 2.

Single-pass loudnorm is a dynamic normaliser working blind and it pumps audibly.
Two-pass is a linear gain calculated from real measurements.

`-f null -` in pass 1 means "decode and measure, write nothing". Note the trailing
`-`: it is the output path.

Pass 1's `outputDurationSec` is the source duration — it decodes the whole file even
though it writes nothing, so progress is meaningful.

---

## Deferred

Not in the closed list, with reasons.

- **Concat** — only trivial with identical codecs, timebases and resolutions. Doing
  it properly means either the concat demuxer plus a compatibility check, or
  re-encoding everything through `concat` filter. Both are a second file-management
  UI, which is a different product.
- **Rotate** — mostly a metadata problem, not a filter problem. Phone video carries a
  rotation tag and the correct fix is usually to change the tag, not re-encode.
  Getting that wrong produces silently sideways video.
- **Subtitle burn-in** — needs font resolution, `libass`, and a file picker for the
  subtitle track. Large surface, narrow audience.
- **Batch** — the whole UI assumes one loaded file. Batch is a different shape of
  application, not a feature.

Anything here, and anything else, is reachable through the editable command bar.
That is what the command bar is for.
