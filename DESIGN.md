# Scrub — design

## The idea

Every video tool is dark. Premiere, Resolve, Final Cut, Handbrake, every ffmpeg wrapper on GitHub. Dark chrome exists in those tools for a real reason: you are judging colour for hours and surrounding brightness biases your eye.

Scrub is not that. It is a utility you open for ninety seconds in the middle of the day, next to a browser, to cut thirty seconds off a clip. So the chrome is light and the video well is dark. The dark belongs to the three places where work happens — the picture (the well), the command (the bar), and the selected operation (a dark chip in the rail) — and nowhere else. That inversion is what makes it not look like every other ffmpeg GUI.

The bold element is the **command bar**: a full-width dark strip fixed to the bottom, monospace, syntax-coloured by token role, updating live as you move any control. It is the only loud thing on the screen. Everything else stays quiet so it can be loud.

## Tokens

### Colour

```
--paper        #EAECF5   app background, a cool violet-cast grey, never white or cream
--surface      #FFFFFF   panels, controls — white is for surfaces, not the app
--line         #CFD4DE   hairlines
--line-strong  #8E949E   control borders and the dropzone outline (3:1 on white)
--ink          #14161A   primary text
--muted        #5E646E   labels, secondary text
--well         #0E1013   video well, command bar
--accent       #3A4FE0   interactive, focus rings, the Run button
--signal       #E8A33D   running state only, nothing else
```

Warm cream with a terracotta accent is the current default look for generated interfaces. So is near-black with one acid-green accent. Neither is used here. The palette is cool and neutral because the picture in the well is the only thing that should carry colour, and a warm chrome would shift how you read it. The paper's violet cast sits one step from the indigo accent, so the chrome reads as one palette rather than a default.

`--signal` is reserved. If amber appears anywhere that is not an operation in progress, it has been misused.

### Dark mode

Light is the default and stays the default — the argument above is about a utility you open for ninety seconds, and that does not change because the lights are off. Dark is offered in Settings, defaulting to the operating system's preference.

Dark is **not** the light scheme inverted. "The dark is where the picture is" still has to hold, so the well remains the darkest surface on screen and the chrome sits above it. Panels become _lighter_ than the page here, the reverse of light mode, because on a dark ground a raised thing reads as nearer.

```
--paper        #252833   cool grey-black, leaning violet like the light paper
--surface      #2E3240   panels, lighter than the page
--line         #3A3F4F   hairlines
--line-strong  #7B8296   control borders (3.3:1 on surface)
--ink          #E9EBF3
--muted        #A2A9BB   6.2:1 on paper
--well         #0B0D11   still the darkest thing
--accent       #8695FF   the same indigo, lifted off a dark ground
--on-accent    #0B0D11   text on the accent
```

Two things fall out of this and are not negotiable:

**The well needs an edge.** Two dark surfaces cannot separate by luminance the way near-white paper did — 16:1 in light, 1.3:1 here. So the well earns a hairline in dark mode (`--well-edge`), which is the same way everything else in Scrub is separated. In light mode that token is transparent.

**Text on the accent flips.** White on the lifted accent is 2.7:1 and fails outright; the dark `--on-accent` is 7.2:1. Any element that puts text on `--accent` uses that token, never `text-white`.

The command-bar syntax colours do not change between modes: they live on `--well`, which is dark either way.

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
│ Trim     │ ┌───────────────────────────────────────┐ │
│ Compress │ │                                       │ │
│ Convert  │ │              video well               │ │
│ Resize   │ │                                       │ │
│ GIF      │ └───────────────────────────────────────┘ │
│  Audio   │ ▮▮▮▮▮▮▮▮▮▮▮▮  filmstrip + scrub handles   │
│ Mute     ├───────────────────────────────────────────┤
│ ──────── │  Start 00:00:12.40    End 00:00:48.10     │
│ Convert  │  ○ Fast  ● Precise                        │
│ Trim     ├───────────────────────────────────────────┤
│ Loudness │ ffmpeg -i in.mp4 -ss 12.4 -to 48.1 …  ⧉ ✎ │
│          │                                  Run  ▸   │
└──────────┴───────────────────────────────────────────┘
```

Rail: 180px, labels only, no icons. Eleven operations with icons would mean eleven icons that each half-describe a verb, and "compress" has no good glyph. Words are unambiguous and this audience reads. The groups are marked by micro labels sitting in hairlines — "Video" above the video operations, "Audio" between the groups. They are separators with a word in them, not headings, so they mark the split without competing with the verbs. The active operation is a dark chip with an accent tick on its left edge, matching the well and the bar: the dark marks where the work is, and the tick is the same accent as the focus ring.

Well: `--well` background, 6px radius, and the video letterboxed inside it. The well keeps its size when the operation changes so the layout does not jump.

Command bar: full bleed to the window edges, 64px, `--well`, sticky bottom, always present including on the empty state where it shows a dimmed placeholder command. Seeing it from the first second sets up what the tool is.

Radius: 6px on controls and the well, 4px on buttons, 0 on the command bar because it bleeds to the edge. Not one radius on everything.

Shadows: none, except the command bar's upward `0 -1px 0 var(--line)`. Separation comes from the paper/surface contrast and hairlines.

## The three things that carry the identity

They are all real data, which is why they cannot look generated.

**Filmstrip.** `ffmpeg -vf "fps=1/N,scale=-2:64" -f image2pipe`, N chosen so you get roughly 40 frames across the timeline width. Real frames from the actual file, butted edge to edge under the scrubber, no gaps and no borders. Trimmed-out regions get 35% opacity rather than a scrim overlay, so you can still see what you are cutting.

**Waveform.** Drawn by ffmpeg's `showwavespic` on the machine that already has the file, not by Wavesurfer in the page. Wavesurfer downloads and decodes the whole file in the browser, which is fine for a thirty-second clip and ruinous for a two-hour recording. The result is one cached image positioned with CSS, the same shape as the filmstrip and for the same reasons.

It sits beneath the filmstrip for video trim and becomes the entire timeline for audio files, which otherwise have nothing to scrub against. Peak-level cuts are easier to find by eye than by ear.

The scale is `cbrt`, chosen by measuring. On a track peaking around -22 dB the drawn shape covered 2% of the height with `lin`, 13% with `sqrt` and 26% with `cbrt`, while `log` reached 61% but flattened ordinary material into a solid block. The picture exists so someone can see where the sound is, so visibility on quiet material matters, and so does keeping the envelope readable on everything else.

**Progress.** The Run button becomes the progress bar in place — it fills left to right in `--signal` with the percentage and elapsed time in mono inside it. No separate progress row appearing and shifting the layout, no spinner. The thing you pressed is the thing that reports.

## Motion

One orchestrated moment: the empty-state dropzone collapsing into the workspace when a file lands. 320ms, spring, with the filmstrip frames appearing left to right as they decode, which is honest because they genuinely arrive in that order.

Everything else is response to an action. Scrub handles follow the pointer with no easing. The command bar cross-fades tokens that changed and leaves the rest, 120ms, so you can see which flag your control just moved.

No entrance animations on panels, no hover lift on anything, no stagger on lists. Respect `prefers-reduced-motion` by dropping to opacity-only.

## Copy

Operation names are verbs the user already has in their head: Trim, Compress, Convert, Resize, GIF, Extract audio, Mute, Replace audio, Normalise loudness.

Button says what happens and the result echoes it. "Run" produces "Done — 4.2 MB, 12s". Never "Submit", never "Processing…".

Empty state: `Drop a video or audio file` on `--paper`, dashed `--line-strong` border, plus one line of `--muted` micro text listing what it can do. An empty screen is an invitation, not a mood.

Errors are specific and never apologise. If ffmpeg fails, the message is what it printed, in mono, with the exit code. If preview is unavailable because the source is HEVC: `Preview unavailable — this file is HEVC, which browsers can't decode. Trimming still works; the timecode fields are exact.` The user needs to know that the tool is not broken.

## Quality floor

Keyboard focus visible everywhere in `--accent`, 2px, offset 2px. Space plays and pauses, `[` and `]` set in and out points, arrow keys nudge by one frame, shift-arrow by one second. All contrast at AA against its own surface. Usable down to 900px; below that the rail becomes a horizontal scroller and the filmstrip halves in height.

## Before adding anything, check

Does it come from the file, or is it decoration? The waveform, the filmstrip and the live command come from the file. A gradient, a glass panel, a 3D element and a floating orb do not. If it is not derived from the user's data or does not change what they can do, cut it.
