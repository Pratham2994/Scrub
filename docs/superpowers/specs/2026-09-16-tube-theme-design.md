# Scrub - the third theme: Tube

Date: 2026-09-16

## The idea

Light and dark are two ways to light one room. Tube is a different room.

Scrub's identity hangs on the command bar being a terminal: monospace, syntax-coloured, live. Tube takes that literally. The whole app becomes the CRT it has been quoting: green phosphor on near-black, every surface squared off, the operations as one horizontal strip under a status header, the command bar as a prompt line with a block cursor. It is the app, re-racked in the machine it already was.

Tube is not a dark-mode variant. Dark mode changes the lighting; Tube changes the layout, the chrome's type colour, the shape language, and the animation vocabulary. It is a fourth option in Settings, not a replacement for anything.

The rules that carried Scrub through the other two themes carry through this one too:

- **The picture is the only thing with colour.** The green is ink, not decoration. The only real image on screen is the one in the well.
- **Amber is reserved for running states.** The prompt is green. Amber appears on the progress dot, the ETA, and the value tokens, and nowhere else.
- **No ambient motion, no clutter.** Everything that moves either responds to the user or reports a run.

## Palette

```
--paper        #071008   the app ground: green-cast black, a tube in a dark room
--surface      #0D1810   panels, raised slightly lighter than the ground
--line         #1D3324   hairlines
--line-strong  #3A7A52   control borders and the dropzone outline, 3.54:1 on surface
--ink          #33D964   the phosphor: all primary text, 10.35:1 on paper
--muted        #5F9D74   secondary text, 5.68:1 on surface
--well         #030604   the video well and the prompt bar, the deepest surface
--well-edge    #1D3324   the well earns a hairline, as in dark mode
--accent       #EAFFF2   white phosphor: interactive things, the inverted chips
--on-accent    #04301A   text on the accent, 13.92:1
--signal       #FFB454   amber, running states only, 10.96:1 on paper
```

Command tokens, on the well:

```
binary    #D9F5DE   ffmpeg, the program itself
flag      #33D964   -ss, -c:v, -crf
value     #FFB454   12.4, libx264, 28
path      #9AF0AE   input and output filenames
transport #5C8066   the flags that talk to Scrub, 4.59:1 on the well
```

Two tokens are added so the inverted elements stop borrowing the well:

```
--invert     --color-well in light and dark, #EAFFF2 in Tube
--on-invert  white in light and dark, #04301A in Tube
```

The active rail chip and the Run key are the inverted elements. Light and dark invert against the dark well; Tube inverts against white phosphor, because in a world where everything is dark, the selection cannot be darker.

**Type.** Headings, labels, the rail, the status header, and queue lines speak Commit Mono. Body copy stays Switzer. **Radii.** Well 0, controls 2, buttons 0. **Shadows.** None, the world has none.

## Layout

Same components, rearranged. The mechanics are one `phosphor:` Tailwind variant matching `[data-theme='phosphor']`, plus conditionals in `AppShell` only. Every other component keeps one set of class names and inherits tokens. The rail already has a horizontal mode below 900px; Tube reuses that styling path at all widths, which is most of the work.

- **Header** becomes a status bar, all mono. File name stays centre. The meta readout (duration, dimensions, codec) sits at the right end, tabular.
- **Rail**: horizontal strip, full width, directly under the header, at every screen size. The video and audio groups are split by the bare hairline the below-900px layout already has. The active operation is an inverted white-phosphor chip. Unavailable operations stay struck through, same rule as everywhere.
- **Main**: full width, since nothing holds a left column. The well and controls are unchanged in content, just wider.
- **Queue**: stays above the bar, becomes scrollback lines: mono, an amber dot on running jobs, no chip borders.
- **Command bar**: stays pinned to the bottom, becomes the prompt. `scrub$` in ink green, `ffmpeg` in binary white, flags green, values amber, paths pale mint, the Run button an inverted key, and a blinking block cursor after the command when idle.

## Motion

The full phosphor package, with the hard lines that keep it from becoming the cliche:

- **Power-on**: the one orchestrated moment, on switching into Tube. A phosphor line expands open to reveal the app, about 280ms, once. Reduced motion: an opacity fade instead.
- **Cursor**: a 7 by 13px block, blinking on 1.1s steps. While a run is in progress it stays solid instead of blinking, so it never competes with the progress numbers.
- **Scanlines**: faint 1px repeating lines at 8% ink alpha, inside the empty well only. Cleared the moment a file loads. Never over text, never over a playing video. Texture lives where the file isn't.
- **Running glow**: the running queue chip breathes a dim amber halo, 1.6s ease-in-out, 9px at 50% alpha peak.
- **Focus halo**: `:focus-visible` keeps its 2px solid ring and gains a soft green glow.
- **Reduced motion**: everything drops to static or opacity-only, via the existing `data-motion='opacity'` convention. The cursor blink is low-frequency steps, the glow is dim; nothing flashes.

## Settings and plumbing

The `Theme` union in `use-theme.ts` gains a fourth value, `phosphor`. It persists in the same `scrub:theme` localStorage key; stored values from before stay valid. The Appearance grid becomes four tiles: System, Light, Dark, Tube, Tube carrying a small green block icon. The caption under the grid swaps per selection; on Tube it says the app is one CRT terminal and that light and dark keep their own argument. The early apply in index.html is untouched, so Tube also loads without a flash.

Switching away from Tube restores the previous layout, because nothing in the store or the server knows the theme exists.

## Floors

Computed, not estimated: ink 10.35:1, muted 6.04:1 on paper and 5.68:1 on surface, line-strong 3.54:1 on surface, on-accent 13.92:1, signal 10.96:1, transport 4.59:1 on the well. All text is 4.5:1 or better, all interactive borders 3:1 or better. The focus ring stays a 2px solid accent ring with the halo added, never the halo instead.

## Testing

- **e2e**: a new describe block switches to Tube in Settings and asserts: `data-theme="phosphor"` on `<html>`, the rail is horizontal at desktop width, the prompt shows the `scrub$` prefix and a cursor element, scanlines exist on the empty state and vanish after an upload, and Tube survives a reload from localStorage.
- **Contrast gate**: `client/scripts/contrast-check.mjs` holds the palette table above and fails on any token below its floor, wired into `npm run verify`.
- The existing 55 e2e tests stay untouched on light and dark.

## Files touched

```
client/src/styles/index.css        phosphor token block, the phosphor: variant, motion keyframes, scanline utility
client/src/lib/use-theme.ts        Theme gains 'phosphor'
client/src/components/SettingsPanel.tsx   fourth tile, caption swap
client/src/AppShell.tsx            phosphor: layout variants, header readout, prompt prefix and cursor
client/src/components/Rail.tsx     strip styling at all widths, inverted active chip
client/src/components/Queue.tsx    scrollback styling, running glow
client/src/components/CommandBar.tsx  prompt prefix, cursor element
client/src/components/MediaWell.tsx   scanline overlay on the empty state
client/src/components/FileStatus.tsx  (same overlay when reached from a route)
client/scripts/contrast-check.mjs  the palette gate
e2e/flows.spec.ts                  the Tube block
```

No server or shared changes. No new dependencies: the motion is CSS keyframes, the motion/react library keeps doing what it already does.

## Not doing

No ambient idle motion. No scanlines over content. No font change for body copy. No second orchestrated moment beyond the power-on. No changes to light or dark, which keep their argument.
