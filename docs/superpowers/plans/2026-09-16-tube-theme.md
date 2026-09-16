# Tube Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tube, a third full theme, to Scrub: green phosphor on green-cast black, a rearranged shell, and a restrained CRT motion vocabulary, selectable in Settings and persisted like the existing themes.

**Architecture:** One component set, theme-driven styling. A fourth `Theme` value (`'phosphor'`) flows through the existing `data-theme` mechanism. A `phosphor:` Tailwind variant and a token block in `index.css` handle styling; layout differences are class-string branches in `AppShell` and `Rail` only (the `workspace:` media variants would otherwise still fire at desktop width and fight the branch). No server or shared changes, no new dependencies.

**Tech Stack:** React 19, Tailwind v4, TypeScript strict, Playwright e2e against the real dev servers, plain Node script for the contrast gate.

**Spec:** `docs/superpowers/specs/2026-09-16-tube-theme-design.md` (this plan argues from it; read both)

## Global Constraints

- No em dashes anywhere: copy, comments, commit messages. Use commas, colons, parens.
- Contrast floors: text 4.5:1, interactive borders 3:1. The Tube values in the spec are computed, not estimated; `contrast-check.mjs` re-verifies them on every `npm run verify`.
- Amber (`--color-signal`) is reserved for running states and the value tokens. Never new amber.
- Reduced motion: everything drops to static or opacity-only, via the existing global rule and the `data-motion='opacity'` convention.
- No changes to `shared/` or `server/`. No new npm dependencies.
- Commits: the user's git identity only, no AI attribution trailers. Do not push; the user pushes.
- `npm run verify` must be green at the end (typecheck, lint, format:check, contrast, build, tests, e2e).

---

### Task 1: The Tube e2e block, written first and red

**Files:**
- Modify: `e2e/flows.spec.ts` (append a new describe at the end of the file)

**Interfaces:**
- Consumes: existing helpers `loadFixture(page)`, `FIXTURE`, `page.getByRole('button', { name: 'Settings' })` (SettingsPanel's gear), `page.locator('nav')` (the rail).
- Produces: the acceptance tests every later task must turn green. Selectors the app must expose: a Settings button named `Tube`, `data-theme="phosphor"` on `<html>`, the text `scrub$`, an element with class `cursor-block`, an element with class `scanlines`, and a horizontal rail at desktop width.

- [ ] **Step 1: Append the Tube describe block**

Append to the end of `e2e/flows.spec.ts`:

```ts
test.describe('the Tube theme', () => {
  const switchToTube = async (page: Page): Promise<void> => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Tube', exact: true }).click();
  };

  test('applies the phosphor theme and keeps it across a reload', async ({ page }) => {
    await switchToTube(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'phosphor');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'phosphor');
  });

  test('lays the rail out horizontally at desktop width, and back when switched away', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await switchToTube(page);

    const rail = page.locator('nav');
    const strip = await rail.boundingBox();
    expect(strip).not.toBeNull();
    // Wide and short: the strip. The vertical rail is tall and narrow.
    expect(strip!.width).toBeGreaterThan(strip!.height * 4);

    // Light restores the vertical rail.
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    const column = await rail.boundingBox();
    expect(column).not.toBeNull();
    expect(column!.height).toBeGreaterThan(column!.width);
  });

  test('turns the command bar into a prompt with a block cursor', async ({ page }) => {
    await switchToTube(page);
    await expect(page.getByText('scrub$')).toBeVisible();
    await expect(page.locator('code .cursor-block')).toBeVisible();
  });

  test('shows scanlines on the empty well and clears them once a file loads', async ({
    page,
  }) => {
    await switchToTube(page);
    await expect(page.locator('.scanlines')).toBeVisible();

    await loadFixture(page);
    await expect(page.locator('.scanlines')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the block, verify it fails**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme"`
Expected: all 4 tests FAIL. The settings panel has no `Tube` button, so the first assertion cannot pass.

- [ ] **Step 3: Format and commit the red tests**

Run: `npx prettier --write e2e/flows.spec.ts`
Then:

```bash
git add e2e/flows.spec.ts
git commit -m "Add the Tube theme e2e block, red until the theme exists"
```

---

### Task 2: The Theme union, the early apply, and the Settings tile

**Files:**
- Modify: `client/src/lib/use-theme.ts:3-17`
- Modify: `client/index.html:28` (the early-apply script)
- Modify: `client/src/components/SettingsPanel.tsx:4-23` (imports, THEMES array), `:101` (the grid), `:122-125` (the caption)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Theme = 'system' | 'light' | 'dark' | 'phosphor'`; `isTheme` accepts `'phosphor'`; a Settings button named `Tube`. Tasks 3-8 all read `useTheme()` to decide styling.

- [ ] **Step 1: Extend the union and the guard**

In `client/src/lib/use-theme.ts`, change the type and guard:

```ts
export type Theme = 'system' | 'light' | 'dark' | 'phosphor';

export function isTheme(value: string): value is Theme {
  return (
    value === 'system' || value === 'light' || value === 'dark' || value === 'phosphor'
  );
}
```

- [ ] **Step 2: Teach the inline script the fourth value**

In `client/index.html`, the script currently only sets `light` or `dark`:

```html
try {
  var t = localStorage.getItem('scrub:theme');
  if (t === 'light' || t === 'dark' || t === 'phosphor')
    document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* storage refused; the media query still applies */
}
```

Without this, a reload flashes the light palette before React applies Tube, which is the one thing a theme switch must never do.

- [ ] **Step 3: Add the tile**

In `client/src/components/SettingsPanel.tsx`, import `Terminal` from lucide-react and add the entry:

```ts
const THEMES: readonly {
  readonly value: Theme;
  readonly label: string;
  readonly icon: typeof Sun;
}[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'phosphor', label: 'Tube', icon: Terminal },
];
```

The import line becomes:

```ts
import { Monitor, Moon, Settings, Sun, Terminal } from 'lucide-react';
```

The tile grid goes from three columns to four:

```tsx
<div className="border-line grid grid-cols-4 gap-1 rounded-control border p-1">
```

- [ ] **Step 4: Swap the caption per selection**

Replace the caption under the grid:

```tsx
{theme === 'phosphor' ? (
  <p className="text-micro text-muted mt-2">
    Tube is the whole app as one CRT terminal: green phosphor on black, and the command bar is
    the prompt. Light and dark keep their argument for the rest of the day.
  </p>
) : (
  <p className="text-micro text-muted mt-2">
    Light is the default, because Scrub is a utility you open for a minute rather than a suite
    you sit in. The video well stays the darkest thing on screen either way.
  </p>
)}
```

- [ ] **Step 5: Run the block**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme"`
Expected: the first test ("applies the phosphor theme and keeps it across a reload") now PASSES. The other three still FAIL (no styling exists yet).

- [ ] **Step 6: Format and commit**

Run: `npx prettier --write client/src/lib/use-theme.ts client/index.html client/src/components/SettingsPanel.tsx`

```bash
git add client/src/lib/use-theme.ts client/index.html client/src/components/SettingsPanel.tsx
git commit -m "Add Tube to the theme choices and the no-flash early apply"
```

---

### Task 3: The phosphor token block, variant, and motion vocabulary in index.css

**Files:**
- Modify: `client/src/styles/index.css` (new variant near the `short:`/`tall:` definitions; invert tokens in `@theme`; the phosphor block next to the dark block; keyframes and utilities near the existing ones; a chrome-typography rule in the base layer)

**Interfaces:**
- Consumes: `data-theme="phosphor"` on `<html>` from Task 2.
- Produces: `phosphor:` variant usable anywhere; classes `animate-cursor-blink`, `animate-chip-glow`, `power-on-screen`; utilities `cursor-block` and `scanlines`; tokens `--color-invert`/`--color-on-invert` in all three worlds. Tasks 4-8 consume these.

- [ ] **Step 1: Define the variant**

Next to the existing custom variants (after the `tall:` line):

```css
@custom-variant phosphor (&:where([data-theme='phosphor'] *));
```

- [ ] **Step 2: Add the invert tokens to the default `@theme` block**

Inside the main `@theme` block (after `--color-signal`):

```css
  /* What the selection inverts against. Light and dark invert against the
     well; Tube inverts against white phosphor, because in a world where
     everything is dark the selection cannot be darker. */
  --color-invert: #0e1013;
  --color-on-invert: #ffffff;
```

- [ ] **Step 3: Add the same tokens to the dark blocks**

In BOTH dark blocks (`:root[data-theme='dark']` and the `prefers-color-scheme` block), after `--color-signal`:

```css
    --color-invert: #0b0d11;
    --color-on-invert: #ffffff;
```

- [ ] **Step 4: Add the phosphor token block**

Right after the dark-mode `@layer base` block closes, add:

```css
/* ─── Tube ─────────────────────────────────────────────────────────────────
   The whole app becomes the CRT the command bar has been quoting: green
   phosphor on green-cast black. It is not a dark-mode variant; it moves the
   layout, the chrome's type colour, the radii, and the motion. Only the
   tokens and the rules below change; every component keeps one set of class
   names. */

@layer base {
  :root[data-theme='phosphor'] {
    color-scheme: dark;

    --color-paper: #071008;
    --color-surface: #0d1810;
    --color-line: #1d3324;
    --color-line-strong: #3a7a52;
    --color-ink: #33d964;
    --color-muted: #5f9d74;
    --color-well: #030604;
    --color-well-edge: #1d3324;
    --color-accent: #eafff2;
    --color-on-accent: #04301a;
    --color-signal: #ffb454;
    --color-invert: #eafff2;
    --color-on-invert: #04301a;

    --color-token-binary: #d9f5de;
    --color-token-flag: #33d964;
    --color-token-value: #ffb454;
    --color-token-path: #9af0ae;
    --color-token-transport: #5c8066;

    /* Squared off. The world has no rounding and no shadows. */
    --radius-well: 0px;
    --radius-control: 2px;
    --radius-button: 0px;
  }

  /* The chrome speaks mono; body copy stays Switzer. The header and the rail
     are chrome, so the rule covers everything inside them. */
  :root[data-theme='phosphor'] :is(.text-heading, .text-label, .text-micro, header, nav) {
    font-family: var(--font-mono);
  }
}
```

- [ ] **Step 5: Add the keyframes and animation tokens**

Next to the existing `scrub-pass-working` keyframes (before the closing `@theme` block at the bottom of the file):

```css
/* The prompt's block cursor. Opacity-only, so reduced motion keeps it. */
@keyframes scrub-cursor-blink {
  50% {
    opacity: 0;
  }
}

/* The running queue chip's halo. Dim: a breathing glow, not a beacon. */
@keyframes scrub-chip-glow {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(255, 180, 84, 0);
  }
  50% {
    box-shadow: 0 0 9px rgba(255, 180, 84, 0.5);
  }
}

/* The one orchestrated moment in Tube: switching in opens a phosphor line
   that expands to reveal the app, then lets go. */
@keyframes scrub-power-on {
  0% {
    transform: scaleY(0.05);
    opacity: 1;
  }
  70% {
    transform: scaleY(1);
    opacity: 1;
  }
  100% {
    transform: scaleY(1);
    opacity: 0;
  }
}

@keyframes scrub-power-on-fade {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
```

And extend the bottom `@theme` block:

```css
@theme {
  --animate-pass-working: scrub-pass-working 1.4s ease-in-out infinite;
  --animate-cursor-blink: scrub-cursor-blink 1.1s steps(1) infinite;
  --animate-chip-glow: scrub-chip-glow 1.6s ease-in-out infinite;
}

(No `--animate-power-on` token: the overlay's `.power-on-screen` rule carries
its own animation, and an unused token invites a second consumer.)
```

- [ ] **Step 6: Add the overlay, cursor, and scanline CSS**

After the `token-change` utility:

```css
/* The power-on overlay. Reduced motion gets a fade instead of the expand. */
.power-on-screen {
  background: var(--color-paper);
  animation: scrub-power-on 300ms ease-out both;
}

.power-on-screen::before {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 50%;
  height: 2px;
  background: var(--color-ink);
  box-shadow: 0 0 12px 1px color-mix(in oklab, var(--color-ink) 60%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .power-on-screen {
    animation: scrub-power-on-fade 120ms ease-out both;
  }
}

/* The focus ring keeps its 2px solid ring and gains a soft halo in Tube.
   The ring stays; the halo is added, never substituted. */
:root[data-theme='phosphor'] :focus-visible {
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 10px 1px color-mix(in oklab, var(--color-ink) 35%, transparent);
}

/* The prompt's block cursor: 7x13, sitting on the baseline like a real one. */
@utility cursor-block {
  display: inline-block;
  width: 7px;
  height: 13px;
  margin-left: 3px;
  vertical-align: -2px;
  flex-shrink: 0;
}

/* Faint scanlines, for the empty well only. Cleared the moment a file loads,
   and never over text or a playing video. */
@utility scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    color-mix(in oklab, var(--color-ink) 8%, transparent) 0 1px,
    transparent 1px 3px
  );
}
```

- [ ] **Step 7: Typecheck and lint the touched workspace**

Run: `npm run typecheck && npx eslint client/src/styles/index.css --no-warn-ignored || true`
Expected: typecheck passes (CSS is not typechecked; the eslint call is a no-op safety). If eslint errors on CSS, skip it; CSS is checked by prettier.

- [ ] **Step 8: Format and commit**

Run: `npx prettier --write client/src/styles/index.css`

```bash
git add client/src/styles/index.css
git commit -m "Add the phosphor token world, its variant, and its motion vocabulary"
```

---

### Task 4: The AppShell re-rack: layout branch, header readout, power-on

**Files:**
- Modify: `client/src/components/AppShell.tsx` (imports, the middle grid, the header, the overlay)

**Interfaces:**
- Consumes: `useTheme()` from `client/src/lib/use-theme.ts`, class `power-on-screen` from Task 3, `summarise()` already in the file.
- Produces: in phosphor the rail sits in a full-width row and the meta readout moves to the header's right end; a `power-on-screen` overlay appears once per switch into Tube.

- [ ] **Step 1: Import the hook and React state helpers**

```ts
import { useEffect, useRef, useState } from 'react';
```

(Currently the file imports `useMemo` from react.) Add the theme import:

```ts
import { useTheme } from '@/lib/use-theme';
```

- [ ] **Step 2: Track the theme and the power-on moment**

At the top of `AppShell`, after the existing hooks:

```tsx
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
  /**
   * Switching into Tube is the world's one orchestrated moment: a phosphor
   * line expands open to reveal the app, once, about 300ms. It plays only on
   * the way in; going back to light or dark is a plain swap, because the
   * ceremony belongs to arriving in the machine.
   */
  const [poweringOn, setPoweringOn] = useState(false);
  const previousTheme = useRef(theme);

  useEffect(() => {
    if (theme === 'phosphor' && previousTheme.current !== 'phosphor') {
      previousTheme.current = theme;
      setPoweringOn(true);
      const timer = setTimeout(() => {
        setPoweringOn(false);
      }, 320);
      return () => {
        clearTimeout(timer);
      };
    }
    previousTheme.current = theme;
  }, [theme]);
```

- [ ] **Step 3: Branch the middle grid**

The middle grid currently carries the `workspace:` two-column classes. In Tube those media variants would still fire at desktop width, so they must be dropped entirely:

```tsx
        <div
          className={
            phosphor
              ? 'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]'
              : 'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] workspace:grid-cols-[var(--spacing-rail)_minmax(0,1fr)] workspace:grid-rows-1'
          }
        >
```

- [ ] **Step 4: Move the meta readout to the header's right end in Tube**

In the header, the centre block currently renders name plus summary. Branch it, and add the readout before the Close button:

```tsx
          <div className="min-w-0 flex-1 text-center">
            {meta ? (
              <>
                <p className="text-body text-ink truncate">{meta.displayName}</p>
                {!phosphor && (
                  <p className="text-micro text-muted truncate tabular-nums">
                    {summarise(meta)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-label text-muted truncate">No file loaded</p>
            )}
          </div>
          {phosphor && meta && (
            /**
             * The status-bar readout: the same facts, moved to the right end,
             * like a deck's timecode display.
             */
            <div className="hidden shrink-0 text-right lg:block">
              <p className="text-micro text-muted truncate tabular-nums">{summarise(meta)}</p>
            </div>
          )}
          {meta && (
            <button ... Close file ... />
          )}
```

- [ ] **Step 5: Render the overlay**

Just before the closing `</DropTarget>`:

```tsx
      {poweringOn && <div aria-hidden className="power-on-screen pointer-events-none fixed inset-0 z-50" />}
```

- [ ] **Step 6: Run the e2e block and typecheck**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme" && npm run typecheck`
Expected: 1 passes, 3 fail. The rail test is still red here: this task widens the row, but the rail's own `workspace:` classes still turn it into a 180px column inside it. That is Task 5's job. Typecheck green.

- [ ] **Step 7: Format and commit**

Run: `npx prettier --write client/src/components/AppShell.tsx`

```bash
git add client/src/components/AppShell.tsx
git commit -m "Re-rack the shell for Tube: horizontal rail row, status readout, power-on"
```

---

### Task 5: The rail strip and the inverted chip

**Files:**
- Modify: `client/src/components/Rail.tsx` (import `useTheme`; branch the nav and link classes; swap the active chip colours to the invert tokens)

**Interfaces:**
- Consumes: `useTheme()`, tokens `--color-invert`/`--color-on-invert` from Task 3.
- Produces: a horizontal strip at every width in Tube, with the active operation as a white-phosphor inverted chip; identical behaviour in light and dark.

- [ ] **Step 1: Read the theme**

```ts
import { useTheme } from '@/lib/use-theme';
```

In `Rail`, before `measure`:

```tsx
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
```

- [ ] **Step 2: Branch the nav classes**

The base classes already describe the horizontal strip (the below-900px layout); the `workspace:` classes turn it vertical. In Tube the `workspace:` classes are dropped so the strip is the layout at every width:

```tsx
      className={cn(
        'border-line bg-paper flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b px-3 py-2',
        phosphor
          ? undefined
          : 'workspace:w-rail workspace:flex-col workspace:gap-0 workspace:overflow-x-visible workspace:overflow-y-auto workspace:border-r workspace:border-b-0 workspace:px-3 workspace:py-2 tall:workspace:py-4',
      )}
```

- [ ] **Step 3: Branch the link padding and the active chip**

```tsx
                  className={({ isActive }) =>
                    cn(
                      'text-body relative block shrink-0 rounded-button px-2 whitespace-nowrap transition-colors duration-100',
                      phosphor ? 'py-1.5' : 'py-1.5 short:workspace:py-1',
                      isActive
                        ? 'bg-invert text-on-invert font-medium'
                        : blocked
                          ? 'text-muted line-through decoration-line-strong/70 hover:text-ink'
                          : 'text-muted hover:text-ink hover:bg-surface/70',
                    )
                  }
```

The active chip changes from `bg-well text-white` to `bg-invert text-on-invert`, which in light and dark resolves to exactly the old colours and in Tube resolves to white phosphor on green-black.

- [ ] **Step 4: Run the e2e block**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme"`
Expected: still 2 failing (prompt, scanlines), 2 passing. No regressions in the rail test.

- [ ] **Step 5: Run the full suite's rail-dependent tests to catch regressions**

Run: `npx playwright test e2e/flows.spec.ts --grep "rail|loading a file"`
Expected: all pass in light mode. The invert tokens must not have changed light/dark rendering.

- [ ] **Step 6: Format and commit**

Run: `npx prettier --write client/src/components/Rail.tsx`

```bash
git add client/src/components/Rail.tsx
git commit -m "Give Tube the horizontal rail strip and the inverted active chip"
```

---

### Task 6: The queue as scrollback, with the running halo

**Files:**
- Modify: `client/src/components/Queue.tsx` (import `useTheme`; container mono; chip chrome dropped in Tube; the glow on running chips)

**Interfaces:**
- Consumes: `useTheme()`, `animate-chip-glow` from Task 3, existing `JobChip` props.
- Produces: in Tube the queue reads as scrollback lines: mono, no chip borders, an amber halo breathing on the running job.

- [ ] **Step 1: Read the theme**

```ts
import { useTheme } from '@/lib/use-theme';
```

In `Queue`, above the early return:

```tsx
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
```

The container gains the mono variant:

```tsx
    <div className="border-line bg-paper flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2 phosphor:font-mono">
```

- [ ] **Step 2: Drop the chip chrome in Tube and add the halo**

In `JobChip`, read the theme the same way (or accept it as a prop from `Queue`: pass `phosphor` down as `readonly phosphor: boolean` and use it). Use a prop to keep one source:

```tsx
function JobChip({ job, phosphor }: { readonly job: QueuedJob; readonly phosphor: boolean }) {
```

Call site: `<JobChip key={job.jobId} job={job} phosphor={phosphor} />`.

The chip container:

```tsx
    <div
      className={cn(
        'text-label relative flex max-w-xs min-w-0 items-center gap-2 overflow-hidden rounded-button border px-2.5 py-1',
        job.status === 'done' ? 'border-line-strong text-ink' : 'border-line text-muted',
        // A scrollback line has no chrome: no border, no padding, no fill.
        // The halo below is the only ornament, and only while running.
        phosphor && 'border-0 px-0 py-0',
        phosphor && job.status === 'running' && 'animate-chip-glow',
      )}
    >
```

- [ ] **Step 3: Run the e2e block**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme"`
Expected: unchanged (2 fail, 2 pass). This task is styling only; the queue is not asserted by the Tube block yet.

- [ ] **Step 4: Format and commit**

Run: `npx prettier --write client/src/components/Queue.tsx`

```bash
git add client/src/components/Queue.tsx
git commit -m "Turn the queue into scrollback lines under Tube"
```

---

### Task 7: The prompt prefix and the block cursor

**Files:**
- Modify: `client/src/components/CommandBar.tsx` (import `useTheme`; prefix span and cursor span inside the code element)

**Interfaces:**
- Consumes: `useTheme()`, utilities `cursor-block` and `animate-cursor-blink` from Task 3, the existing `run` prop (for the solid-while-running rule).
- Produces: `scrub$` before the command and a `cursor-block` span at its end in Tube; nothing changes in light and dark.

- [ ] **Step 1: Read the theme**

```ts
import { useTheme } from '@/lib/use-theme';
```

In `CommandBar`, after `const [passIndex, setPassIndex] = useState(0);`:

```tsx
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
```

- [ ] **Step 2: Add the prefix before the command**

The collapsed bar renders either the editor or the code row. The prefix belongs to the code row, before the code element. The edit is mechanical: wrap the existing `{editing && analysis !== null ? (...) : (...)}` so the non-editing branch returns a fragment with the prefix in front of the unchanged code `div`:

```tsx
      {editing && analysis !== null ? (
        <CommandEditor text={text} onTextChange={setDraft} result={analysis} />
      ) : (
        <>
          {phosphor && (
            <span aria-hidden className="text-token-flag text-mono shrink-0 font-medium">
              scrub$
            </span>
          )}
          <div className="relative min-w-0 grow basis-64 self-center">
            <code ...> ... </code>
            <Fade side="left" visible={edges.left} />
            <Fade side="right" visible={edges.right} />
          </div>
        </>
      )}
```

The `<code>` element, its contents, and the two `<Fade>` elements are exactly as they already are; only the wrapper changes.

- [ ] **Step 3: Add the cursor inside the code element**

After the `tokens.map(...)` inside the `<code>`, still inside it (so it scrolls with the command, like a real prompt's cursor):

```tsx
            {phosphor && (
              /**
               * The block cursor, solid while a run is in progress: a blinking
               * cursor next to the progress numbers competes with the one thing
               * the user is watching. Empty, so it adds nothing to the copied
               * or announced text.
               */
              <span
                aria-hidden
                className={cn('cursor-block bg-token-flag', run.status !== 'running' && 'animate-cursor-blink')}
              />
            )}
```

`cn` is already imported in this file.

- [ ] **Step 4: Run the e2e block and the command-bar tests**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme|command bar"`
Expected: the prompt test now PASSES (`scrub$` visible, `code .cursor-block` visible). The scanline test still FAILS. The existing command-bar tests pass unchanged: the cursor span is empty so `commandText()` output is untouched, and the prefix is outside `<code>`.

- [ ] **Step 5: Format and commit**

Run: `npx prettier --write client/src/components/CommandBar.tsx`

```bash
git add client/src/components/CommandBar.tsx
git commit -m "Make the command bar the prompt in Tube: scrub$ and a block cursor"
```

---

### Task 8: Scanlines on the empty well

**Files:**
- Modify: `client/src/components/Dropzone.tsx` (import `useTheme`; `relative` on the container; the overlay)

Deviation from the spec's file list, deliberate: the spec names `MediaWell.tsx` and `FileStatus.tsx`, but the empty well in both routes IS the `Dropzone` component, and `MediaWell` only ever renders with a file loaded. Putting the overlay in `Dropzone` gives "scanlines on the empty state, cleared on load" by construction, since the dropzone unmounts the moment a file lands.

**Interfaces:**
- Consumes: `useTheme()`, utility `scanlines` from Task 3.
- Produces: a scanline overlay inside the dropzone, Tube only. The moment a file lands, `Dropzone` unmounts, which is how the lines clear.

- [ ] **Step 1: Read the theme and make the container positioned**

```ts
import { useTheme } from '@/lib/use-theme';
```

In `Dropzone`:

```tsx
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
```

Add `relative` to the dropzone container's class list (it currently starts `'flex h-full min-h-48 flex-1 cursor-pointer ...'`):

```tsx
        'relative flex h-full min-h-48 flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-well border border-dashed px-6 py-10 text-center transition-colors duration-100',
```

- [ ] **Step 2: Add the overlay**

As the first child of the dropzone container:

```tsx
      {phosphor && (
        /**
         * Texture lives where the file isn't: faint scanlines on the empty
         * well, the CRT's idle screen. The dropzone unmounts the moment a
         * file lands, so the lines can never sit under a picture.
         */
        <div aria-hidden className="scanlines pointer-events-none absolute inset-0 rounded-well" />
      )}
```

- [ ] **Step 3: Run the e2e block**

Run: `npx playwright test e2e/flows.spec.ts --grep "Tube theme"`
Expected: all 4 Tube tests PASS. The block is green for the first time.

- [ ] **Step 4: Format and commit**

Run: `npx prettier --write client/src/components/Dropzone.tsx`

```bash
git add client/src/components/Dropzone.tsx
git commit -m "Give the empty well its idle scanlines under Tube"
```

---

### Task 9: The full suite, everything still standing

**Files:**
- None (verification only).

- [ ] **Step 1: Run the whole e2e suite**

Run: `npx playwright test`
Expected: 59 tests pass (55 existing + 4 Tube). If any pre-existing test breaks, it is a regression from Tasks 2-8; fix the component before committing anything else.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: green, except the three pre-existing react-refresh warnings which stay untouched.

---

### Task 10: The contrast gate, wired into verify

**Files:**
- Create: `client/scripts/contrast-check.mjs`
- Modify: `package.json:27-29` (add a `contrast` script, insert it into `verify`)

**Interfaces:**
- Consumes: nothing; standalone Node 22 script.
- Produces: `npm run contrast` exits 1 when any palette token drops below its floor, printing the table and the failures. `npm run verify` runs it before the build.

- [ ] **Step 1: Write the script**

```js
// The palette gate: every text token and control border in every theme,
// checked against the WCAG floors in docs/DESIGN.md and the Tube spec.
// Plain Node so it runs before any build.

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function lum(hex) {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // WCAG 1.4.3 AA
const BORDER = 3; // WCAG 1.4.11 AA

const palettes = {
  light: {
    paper: '#eaecf5',
    surface: '#ffffff',
    line: '#cfd4de',
    lineStrong: '#8e949e',
    ink: '#14161a',
    muted: '#5e646e',
    well: '#0e1013',
    accent: '#3a4fe0',
    onAccent: '#ffffff',
    signal: '#e8a33d',
    tokens: { binary: '#e7e9ec', flag: '#8aa0ff', value: '#e8a33d', path: '#7fd1a8', transport: '#757d89' },
  },
  dark: {
    paper: '#252833',
    surface: '#2e3240',
    line: '#3a3f4f',
    lineStrong: '#7b8296',
    ink: '#e9ebf3',
    muted: '#a2a9bb',
    well: '#0b0d11',
    accent: '#8695ff',
    onAccent: '#0b0d11',
    signal: '#e8a33d',
    tokens: { binary: '#e7e9ec', flag: '#8aa0ff', value: '#e8a33d', path: '#7fd1a8', transport: '#757d89' },
  },
  phosphor: {
    paper: '#071008',
    surface: '#0d1810',
    line: '#1d3324',
    lineStrong: '#3a7a52',
    ink: '#33d964',
    muted: '#5f9d74',
    well: '#030604',
    accent: '#eafff2',
    onAccent: '#04301a',
    signal: '#ffb454',
    tokens: { binary: '#d9f5de', flag: '#33d964', value: '#ffb454', path: '#9af0ae', transport: '#5c8066' },
  },
};

/** Pairs and their floor. Hairlines (line) have no WCAG floor and are printed only. */
const checks = (p) => [
  ['ink / paper', p.ink, p.paper, TEXT],
  ['muted / paper', p.muted, p.paper, TEXT],
  ['muted / surface', p.muted, p.surface, TEXT],
  ['line-strong / surface', p.lineStrong, p.surface, BORDER],
  ['on-accent / accent', p.onAccent, p.accent, TEXT],
  ['signal / paper', p.signal, p.paper, TEXT],
  ['transport / well', p.tokens.transport, p.well, TEXT],
];

let failed = false;
for (const [name, p] of Object.entries(palettes)) {
  console.log(`\n${name}`);
  for (const [label, fg, bg, floor] of checks(p)) {
    const r = ratio(fg, bg);
    const ok = r >= floor;
    failed ||= !ok;
    console.log(`  ${label.padEnd(26)} ${r.toFixed(2)}:1  (floor ${floor}:1)${ok ? '' : '  FAIL'}`);
  }
  console.log(`  line / paper            ${ratio(p.line, p.paper).toFixed(2)}:1  (hairline, informational)`);
}

if (failed) {
  console.error('\nContrast floors broken. Fix the token above before shipping.');
  process.exit(1);
}
console.log('\nAll contrast floors clear.');
```

- [ ] **Step 2: Run it and see the table**

Run: `node client/scripts/contrast-check.mjs`
Expected: exit 0, and the phosphor column shows the spec's numbers (ink 10.35:1, muted 5.68:1 on surface, line-strong 3.54:1, on-accent 13.92:1, signal 10.96:1, transport 4.59:1). If any number differs from the spec, update the spec to the measured value: the script is the truth.

- [ ] **Step 3: Wire it into verify**

In the root `package.json` scripts:

```json
    "contrast": "node client/scripts/contrast-check.mjs",
    "verify": "npm run typecheck && npm run lint && npm run format:check && npm run contrast && npm run build && npm run test && npm run test:e2e"
```

- [ ] **Step 4: Verify the gate catches a break**

Run: `node -e "process.exit(0)"` is not the test; instead temporarily edit `#33d964` to `#33d960` in the script's phosphor block, run `node client/scripts/contrast-check.mjs` and watch it FAIL, then revert the edit.
Expected: exit 1 with the failing pair named.

- [ ] **Step 5: Format and commit**

Run: `npx prettier --write client/scripts/contrast-check.mjs package.json`

```bash
git add client/scripts/contrast-check.mjs package.json
git commit -m "Gate every palette's contrast floors in verify"
```

---

### Task 11: The design doc, and the final full verification

**Files:**
- Modify: `docs/DESIGN.md` (new `### Tube` section after `### Dark mode`; the motion doctrine line)
- Modify: `client/src/lib/motion.ts:5-8` (the comment naming the one orchestrated moment)

**Interfaces:**
- Consumes: the spec, and the shipped values from Tasks 2-10.
- Produces: docs that describe what the build actually does, which is the repo's convention.

- [ ] **Step 1: Add the Tube section to DESIGN.md**

After the `### Dark mode` section (after the line about `--on-accent`), insert:

````markdown
### Tube

Light and dark are two ways to light one room. Tube is a different room: the whole app becomes the CRT the command bar has been quoting. It is a fourth option in Settings, not a replacement, and it changes the layout and the motion, not just the tokens.

```
--paper        #071008   green-cast black, a tube in a dark room
--surface      #0D1810   panels, raised slightly lighter
--line         #1D3324   hairlines
--line-strong  #3A7A52   control borders, 3.54:1 on surface
--ink          #33D964   the phosphor, 10.35:1 on paper
--muted        #5F9D74   5.68:1 on surface
--well         #030604   the deepest surface
--well-edge    #1D3324   the well earns a hairline, as in dark mode
--accent       #EAFFF2   white phosphor: interactive things
--on-accent    #04301A   13.92:1
--signal       #FFB454   amber stays reserved for running states
```

Command tokens on the well: binary #D9F5DE, flag #33D964, value #FFB454, path #9AF0AE, transport #5C8066.

The selection inverts against two new tokens, `--invert` and `--on-invert`, which light and dark keep at the well colours and Tube sets to white phosphor. The active rail chip uses them; the Run key stays on `--accent`, which is already the same appearance in every world.

Layout: the rail becomes a horizontal strip under the header at every width, the meta readout moves to the header's right end, the well takes the full width, the queue reads as scrollback lines, and the command bar becomes the prompt with `scrub$` and a block cursor. The chrome speaks mono; body copy stays Switzer. Radii drop to 0 on the well and buttons and 2 on controls, and there are no shadows.

Motion: the power-on line expands open when switching in, the cursor blinks on 1.1s steps and goes solid while a run is in progress, the running queue chip breathes a dim amber halo, focus keeps its ring and gains a soft green halo. Scanlines exist inside the empty well only and clear the moment a file loads. Reduced motion drops everything to static or opacity-only.

That makes the motion doctrine "one orchestrated moment per world": the handoff in light and dark, the power-on when arriving in Tube, and neither plays during work.
````

- [ ] **Step 2: Amend the motion.ts comment**

In `client/src/lib/motion.ts`, the doc comment currently says the product allows exactly one orchestrated moment. Extend it:

```ts
/**
 * Every duration in the product, in one place.
 *
 * docs/DESIGN.md allows one orchestrated moment per world: the handoff in
 * light and dark, the power-on when arriving in Tube, and otherwise only
 * response to an action. Keeping the numbers here rather than scattered
 * through components is what stops a second moment appearing by accident.
 */
```

- [ ] **Step 3: The full gate**

Run: `npm run verify`
Expected: everything green: typecheck, lint, format:check, contrast, build, 163 shared + 64 server tests, 59 e2e tests.

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md client/src/lib/motion.ts
git commit -m "Document the Tube world and its one orchestrated moment"
```

---

## Definition of done

- The Tube tile in Settings switches the whole app to the phosphor world and back, survives reloads with no flash, and remembers itself per person.
- The layout difference is real (horizontal rail, full-width well, status readout, prompt bar with cursor) and every one of the 14 operations, the queue, the keyboard shortcuts, and the failure card behave identically in Tube.
- The four Tube e2e tests pass, the full 59-test suite passes, and `npm run verify` includes the contrast gate.
- `docs/DESIGN.md` documents the world; the spec and this plan live under `docs/superpowers/`.
