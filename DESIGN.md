# Scrub — design

## The idea

Every video tool is dark. Premiere, Resolve, Final Cut, Handbrake, every ffmpeg wrapper on GitHub. Dark chrome exists in those tools for a real reason: you are judging colour for hours and surrounding brightness biases your eye.

Scrub is not that. It is a utility you open for ninety seconds in the middle of the day, next to a browser, to cut thirty seconds off a clip. So the chrome is light and the video well is dark. The dark is where the picture is, and nowhere else. That single inversion is what makes it not look like every other ffmpeg GUI.

The bold element is the **command bar**: a full-width dark strip fixed to the bottom, monospace, syntax-coloured by token role, updating live as you move any control. It is the only loud thing on the screen. Everything else stays quiet so it can be loud.

## Tokens

### Colour

```
--paper     #F1F2F4   app background, cool grey, not cream
--surface   #FFFFFF   panels, controls
--line      #DFE1E5   hairlines and control borders
--ink       #14161A   primary text
--muted     #5E646E   labels, secondary text
--well      #0E1013   video well, command bar
--accent    #3A4FE0   interactive, focus rings, the Run button
--signal    #E8A33D   running state only, nothing else
```

Warm cream with a terracotta accent is the current default look for generated interfaces. So is near-black with one acid-green accent. Neither is used here. The palette is cool and neutral because the picture in the well is the only thing that should carry colour, and a warm chrome would shift how you read it.

`--signal` is reserved. If amber appears anywhere that is not an operation in progress, it has been misused.

Command bar syntax colours, on `--well`:

```
binary    #E7E9EC   ffmpeg
flag      #8AA0FF   -ss, -c:v, -crf
value     #E8A33D   00:00:12, libx264, 28
path      #7FD1A8   input and output filenames
```

### Type

**Switzer** (Fontshare, free) for the interface. **Commit Mono** (free) for commands, timecodes, durations, bitrates, file sizes.

The monospace is not decoration. Timecodes must have tabular figures or the numbers jitter while the scrubber moves, and a jittering timecode is genuinely distracting when you are trying to land on a frame. Set `font-variant-numeric: tabular-nums` on every numeric readout.

Inter and JetBrains Mono are the reflexive picks and would make this look like a template. Switzer is close enough to be neutral, tight enough to have an opinion.

Scale, sentence case throughout, no all-caps labels:

```
display   28 / 32   -0.02em   file name
heading   17 / 24   -0.01em   operation title
body      14 / 20             controls, prose
label     13 / 18             field labels, --muted
mono      13 / 18             commands, timecodes
micro     11 / 14             stream metadata under the file name
```

### Layout

One workspace. Left rail of operations, centre well, fixed command bar. Left aligned, no centred text anywhere except the empty state.

```
┌──────────────────────────────────────────────────────┐
│ Scrub                          holiday-clip.mp4   ⚙  │
├──────────┬───────────────────────────────────────────┤
│ Video    │ ┌───────────────────────────────────────┐ │
│  Trim    │ │                                       │ │
│  Compress│ │              video well               │ │
│  Convert │ │                                       │ │
│  Resize  │ └───────────────────────────────────────┘ │
│  GIF     │ ▮▮▮▮▮▮▮▮▮▮▮▮  filmstrip + scrub handles   │
│  Audio   │                                           │
│  Mute    ├───────────────────────────────────────────┤
│          │  Start 00:00:12.40    End 00:00:48.10     │
│ Audio    │  ○ Fast  ● Precise                        │
│  Convert │                                           │
│  Trim    ├───────────────────────────────────────────┤
│  Loudness│ ffmpeg -i in.mp4 -ss 12.4 -to 48.1 …  ⧉ ✎ │
│          │                                  Run  ▸   │
└──────────┴───────────────────────────────────────────┘
```

Rail: 180px, labels only, no icons. Ten operations with icons would mean ten icons that each half-describe a verb, and "compress" has no good glyph. Words are unambiguous and this audience reads.

Well: `--well` background, 6px radius, and the video letterboxed inside it. The well keeps its size when the operation changes so the layout does not jump.

Command bar: full bleed to the window edges, 64px, `--well`, sticky bottom, always present including on the empty state where it shows a dimmed placeholder command. Seeing it from the first second sets up what the tool is.

Radius: 6px on controls and the well, 4px on buttons, 0 on the command bar because it bleeds to the edge. Not one radius on everything.

Shadows: none, except the command bar's upward `0 -1px 0 var(--line)`. Separation comes from the paper/surface contrast and hairlines.

## The three things that carry the identity

They are all real data, which is why they cannot look generated.

**Filmstrip.** `ffmpeg -vf "fps=1/N,scale=-2:64" -f image2pipe`, N chosen so you get roughly 40 frames across the timeline width. Real frames from the actual file, butted edge to edge under the scrubber, no gaps and no borders. Trimmed-out regions get 35% opacity rather than a scrim overlay, so you can still see what you are cutting.

**Waveform.** Wavesurfer on the decoded audio, `--ink` at 60%, for audio operations and shown beneath the filmstrip for video trim. Peak-level cuts are easier to find by eye than by ear.

**Progress.** The Run button becomes the progress bar in place — it fills left to right in `--signal` with the percentage and elapsed time in mono inside it. No separate progress row appearing and shifting the layout, no spinner. The thing you pressed is the thing that reports.

## Motion

One orchestrated moment: the empty-state dropzone collapsing into the workspace when a file lands. 320ms, spring, with the filmstrip frames appearing left to right as they decode, which is honest because they genuinely arrive in that order.

Everything else is response to an action. Scrub handles follow the pointer with no easing. The command bar cross-fades tokens that changed and leaves the rest, 120ms, so you can see which flag your control just moved.

No entrance animations on panels, no hover lift on anything, no stagger on lists. Respect `prefers-reduced-motion` by dropping to opacity-only.

## Copy

Operation names are verbs the user already has in their head: Trim, Compress, Convert, Resize, GIF, Extract audio, Mute, Replace audio, Normalise loudness.

Button says what happens and the result echoes it. "Run" produces "Done — 4.2 MB, 12s". Never "Submit", never "Processing…".

Empty state: `Drop a video or audio file` on `--paper`, dashed `--line` border, plus one line of `--muted` micro text listing what it can do. An empty screen is an invitation, not a mood.

Errors are specific and never apologise. If ffmpeg fails, the message is what it printed, in mono, with the exit code. If preview is unavailable because the source is HEVC: `Preview unavailable — this file is HEVC, which browsers can't decode. Trimming still works; the timecode fields are exact.` The user needs to know that the tool is not broken.

## Quality floor

Keyboard focus visible everywhere in `--accent`, 2px, offset 2px. Space plays and pauses, `[` and `]` set in and out points, arrow keys nudge by one frame, shift-arrow by one second. All contrast at AA against its own surface. Usable down to 900px; below that the rail becomes a horizontal scroller and the filmstrip halves in height.

## Before adding anything, check

Does it come from the file, or is it decoration? The waveform, the filmstrip and the live command come from the file. A gradient, a glass panel, a 3D element and a floating orb do not. If it is not derived from the user's data or does not change what they can do, cut it.
