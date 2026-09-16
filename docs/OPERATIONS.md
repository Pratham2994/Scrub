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
basenames for reading and dims the transport flags, but that is rendering - `Copy`
yields the true command, and nothing is appended downstream.

**`outputDurationSec` is the progress denominator.** Not the source duration. See
[Progress](#progress).

`buildArgs` is pure: no I/O, no clock, no randomness. That is what makes every
operation and parameter combination a snapshot test, and CLAUDE.md is right that
this is the highest-value test surface in the project.

## What applies to what

An mp4 can hold video, audio, or both, so the operation the user picked and the
file they loaded do not always fit together. `availabilityOf(kind, meta)` in
`shared` decides, and both the rail and `buildArgs` consult it.

This is not defensive tidiness. Before it existed, a resize of an mp3 **reported
success and handed back an untouched copy**, because ffmpeg silently ignores
`-vf scale` on a file with no video. Compress did the same. GIF and mute failed
with a bare exit code. A tool whose promise is showing you the command must not
show you one that cannot work.

| Operation                 | Audio only                 | Video, no sound | Video with sound  |
| ------------------------- | -------------------------- | --------------- | ----------------- |
| Trim                      | yes                        | yes             | yes               |
| Compress, Convert, Resize | no picture                 | yes             | yes               |
| GIF                       | no frames                  | yes             | yes               |
| Mute                      | nothing left               | already silent  | yes               |
| Fit a size, Speed, Crop   | no picture                 | yes             | yes               |
| Replace audio             | no picture                 | yes             | yes               |
| Extract audio             | already audio, use Convert | no track        | yes               |
| Audio: Convert            | yes                        | no track        | use Extract audio |
| Audio: Trim               | yes                        | no track        | use Trim          |
| Loudness                  | yes                        | no track        | yes               |

Two entries are about avoiding duplicates rather than impossibility. On a video,
**Audio: Trim** is Trim under another name, because trimming a container cuts
every stream in it, and **Audio: Convert** is Extract audio, because it drops
the picture. Two routes to one result is how a closed operation list starts to
rot, so those say which operation to use instead and link to it.

**Loudness is the exception** among audio operations: on a video it corrects the
sound and copies the picture through untouched, which nothing else does.

## Transport flags

Every pass begins with `TRANSPORT_ARGS`:

```
-hide_banner -nostdin -nostats -progress pipe:1
```

and ends its options with `-y` before the output path.

- `-nostdin` - without it ffmpeg reads stdin and can swallow keystrokes or block.
- `-nostats -progress pipe:1` - machine-readable progress on **stdout**. The
  human-readable stderr log is not a progress source; it is rate-limited, carriage
  returned, and format-unstable.
- `-y` - output ids are freshly minted, but with `-nostdin` a collision would hang
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

### Trim - fast ✅

```
ffmpeg -ss 12.4 -i in.mp4 -t 35.7 -c copy -avoid_negative_ts make_zero -y out.mp4
```

`-ss` **before** `-i` is an input option: ffmpeg seeks the demuxer instead of
decoding up to the mark. That is the entire point of the fast path, and also its
cost - with `-c copy` the cut can only land on a keyframe, so the output may begin
_earlier_ than asked and run _longer_. Users read "Fast" as "less accurate"; they do
not expect "longer than I asked for". The UI has to say so.

`-t` not `-to`. `-t` is unambiguously the duration of the output. `-to` combined
with an input-side `-ss` is the exact pairing whose meaning people get wrong. The
user thinks in start/end; the conversion to a duration happens in `buildArgs`, once,
where a test pins it.

`-avoid_negative_ts make_zero` - a stream copy starting mid-stream carries the
source's timestamps, and the first packet can land before zero. Some players render
that as a frozen opening frame.

End is clamped to `meta.durationSec`: a scrub handle dragged to the far right can
land a hair past the probed duration through float accumulation, and the displayed
command should say where the cut actually ends.

### Trim - precise ✅

```
ffmpeg -i in.mp4 -ss 12.4 -t 35.7 -c:v libx264 -crf 18 -preset veryfast -c:a copy -y out.mp4
```

`-ss` **after** `-i` is an output option: frame-accurate, because ffmpeg decodes to
the mark and re-encodes from there. Slower and lossy. Do not pick fast or precise for
the user - the trim UI exposes it as a toggle, and states what each one costs.

CRF 18 because this is a cut, not a compression: the user asked for a different
length, not a smaller file. `veryfast` for the same reason - the point is to get
the cut, not to squeeze out the last few percent of size.

Audio can usually still be `-c:a copy`. Re-encoding it as well costs quality for no
benefit when only the video needed cutting.

### Compress ✅

```
ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k -movflags +faststart -y out.mp4
```

CRF, not a target bitrate: the user wants "smaller" and does not have a bitrate
budget in mind. 18 is near-lossless, 23 default, 28 visibly soft. `-preset` trades
encode time for file size at the same quality - it is not a quality control, which
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

### GIF - two passes ✅

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

Pass 1's `outputDurationSec` is `null` - it produces a single PNG, not a timeline.

### Extract audio ✅

```
ffmpeg -i in.mp4 -vn -acodec copy -y out.m4a
```

`-vn` drops video. Prefer `-acodec copy` when the requested format already matches
the source codec - an AAC track out of an mp4 needs no re-encode, and re-encoding it
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

`-shortest` ends at whichever track runs out first. The alternatives - padding the
audio or letting video run silent - are both decisions the user should make, so
surface it rather than baking it in.

The replacement track arrives as its own upload id; the server resolves it to a path.

### Fit a size - two passes ✅

```
ffmpeg -i in.mp4 -c:v libx264 -b:v 1143k -maxrate 1715k -bufsize 2286k \
  -vf scale=min(1280\,iw):-2 -passlogfile /work/.tmp/scrub-2pass -pass 1 -an -f null -
ffmpeg -i in.mp4 -c:v libx264 -b:v 1143k -maxrate 1715k -bufsize 2286k \
  -vf scale=min(1280\,iw):-2 -passlogfile /work/.tmp/scrub-2pass -pass 2 \
  -c:a aac -b:a 128k -movflags +faststart -y out.mp4
```

The question every other compression control cannot answer. CRF asks how _good_,
and gives whatever size that quality happens to take; a platform limit asks how
_big_. They are different questions and they need different commands.

**The bitrate is arithmetic, not a guess.** `videoBitrateKbps()` in `shared` is the
whole of it: the target in kbit, less 2% for muxing overhead, less the audio budget,
divided by the duration. Both deductions are why a "10 MB" encode otherwise lands at
10.4 MB and gets refused after the upload, which is worse than not having offered.

**Two passes, because one would waste the budget.** A single pass at a fixed bitrate
spends it evenly across the file. The first pass here writes a log describing how
hard each part is to encode and the second spends the budget accordingly, so the
parts that move get the bits and the still parts do not. At small targets this is
the difference between watchable and blocky.

`-maxrate` at 1.5x and `-bufsize` at 2x cap the peak, so a busy few seconds cannot
blow the budget and push the file over the limit the operation exists to stay under.

**It refuses rather than encode a smear.** Below about 100 kbit/s h264 stops being a
picture. When the target cannot hold the duration, `buildArgs` throws with the
length that _would_ have fitted, because "no" on its own is not actionable.

Pass one must be given the same video settings as pass two. It is measuring how
_this_ encode behaves; different settings would measure a different one. It writes
nothing - `-f null -` - and `-an` keeps it from spending time on audio it discards.

The presets live in `shared/src/size-presets.ts`, with the date each limit was
checked and a note saying why that number. They move: Discord's free tier was
rolling out from 10 MB toward 20 MB through 2026, so Scrub aims at the number that
works on every account. Gmail's "25 MB" is the _encoded_ size and attachments are
base64, which adds about a third - the real ceiling for the file is nearer 18 MB.
Where a limit is ambiguous the smaller number wins: too small is merely smaller
than it needed to be, too large is rejected.

### Speed ✅

```
ffmpeg -i in.mp4 -vf setpts=PTS/2 -af atempo=2 -c:a aac -b:a 128k \
  -c:v libx264 -crf 20 -preset medium -movflags +faststart -y out.mp4
```

`setpts` restamps the frames - dividing the timestamps by two plays it twice as
fast. The audio needs `atempo`, a different filter taking a different unit, and the
two have to agree exactly or the result drifts apart as it plays. That is why this
is one control and not two.

`atempo` accepts 0.5 to 2.0 per instance, so anything beyond is a chain: 4x is
`atempo=2.0,atempo=2.0`. `atempoChain()` builds it and a test checks the product
multiplies back to the factor asked for, because a chain that does not is a file
whose sound slides away from its picture.

`atempo` changes tempo without changing pitch, so speech stays speech.

**The pass's `outputDurationSec` is the source duration divided by the factor**, not
the source duration. Progress divides against the output; getting this wrong stops
the bar at 50% for a 2x speed-up, or runs it past the end for a slow-down.

### Crop ✅

```
ffmpeg -i in.mp4 -vf crop=640:360:100:50 -c:v libx264 -crf 20 -preset medium \
  -c:a copy -movflags +faststart -y out.mp4
```

`crop=w:h:x:y`, with the offset measured from the top left.

**Every number is rounded down to an even one.** libx264 needs even dimensions, for
the same reason `-2` exists in resize. The offset matters just as much and is easier
to miss: in yuv420p the chroma planes are half resolution, so an odd `x` or `y` puts
them half a pixel out of step with the luma. That does not fail - it produces a
colour fringe along the edges that nobody notices until they look closely.

The rectangle is clamped to the frame. ffmpeg errors outright on a crop that runs
off the edge, and a filter graph error is a worse way to learn you dragged too far
than simply not being able to.

The sound is copied, not re-encoded. A crop does not touch it.

The UI holds the rectangle as **fractions of the frame**, not pixels, so the same
selection means the same crop whatever size the preview is drawn at, and it survives
the window being resized mid-drag. `use-command.ts` converts once, against the
dimensions ffprobe reported.

## Audio

### Convert ✅

```
ffmpeg -i in.wav -c:a libmp3lame -b:a 192k -y out.mp3
```

Encoder by target: `libmp3lame` / `aac` / `pcm_s16le` (wav) / `flac` / `libopus`.
Bitrate is meaningless for `wav` and `flac` - they are uncompressed and lossless
respectively, so the control should disappear rather than be ignored.

### Trim

Same argument as video trim, minus the keyframe problem. Audio codecs have far
smaller frames, so `-c copy` is close to sample-accurate and there is no
fast/precise decision to force on anyone.

### Loudness - two passes, with a data dependency ✅

```
pass 1: ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
pass 2: ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true -y out.wav
```

This is the only operation where a pass needs data from the one before it, which is
what `CommandPass.capture: 'loudnorm-json'` marks. Pass 1 measures and prints a JSON
block **on stderr**; the five measured values go into pass 2.

Pass 2's argv carries them as `@measured_I@`, `@measured_TP@`, `@measured_LRA@`,
`@measured_thresh@` and `@offset@`, and the server substitutes them once it has
parsed pass 1. Marking them rather than omitting them keeps the command bar
honest - it shows that pass 2 depends on pass 1, instead of displaying a command
that is not the one which runs.

The markers are deliberately invalid ffmpeg syntax. A pass that somehow reached
`spawn` unsubstituted has to fail loudly, because the alternative is normalising
against nothing - silently producing the blind, pumping result that two passes
exist to avoid.

Verified end to end: a track at -43.85 LUFS normalised to a -16 target comes out
at -16.03.

Single-pass loudnorm is a dynamic normaliser working blind and it pumps audibly.
Two-pass is a linear gain calculated from real measurements.

`-f null -` in pass 1 means "decode and measure, write nothing". Note the trailing
`-`: it is the output path.

Pass 1's `outputDurationSec` is the source duration - it decodes the whole file even
though it writes nothing, so progress is meaningful.

---

## Deferred

Not in the closed list, with reasons.

- **Concat** - only trivial with identical codecs, timebases and resolutions. Doing
  it properly means either the concat demuxer plus a compatibility check, or
  re-encoding everything through `concat` filter. Both are a second file-management
  UI, which is a different product.
- **Rotate** - mostly a metadata problem, not a filter problem. Phone video carries a
  rotation tag and the correct fix is usually to change the tag, not re-encode.
  Getting that wrong produces silently sideways video.
- **Subtitle burn-in** - needs font resolution, `libass`, and a file picker for the
  subtitle track. Large surface, narrow audience.
- **Batch** - the whole UI assumes one loaded file. Batch is a different shape of
  application, not a feature.

Anything here, and anything else, is reachable through the editable command bar.
That is what the command bar is for.
