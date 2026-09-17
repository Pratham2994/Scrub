import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPERATIONS } from '@scrub/shared';
import { expect, type Page, test } from '@playwright/test';

/**
 * End-to-end coverage of the flows that matter, against a real ffmpeg.
 *
 * These are deliberately not mocked. The whole product is "the command Scrub
 * shows is the command that runs", and a suite that stubbed the server out
 * would be testing the one half of that claim which was never in doubt.
 *
 * The fixture is three seconds at 320x180 and about 47 kB - small enough to
 * commit, real enough to encode.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE = path.join(FIXTURES, 'clip.mp4');
/** Audio with no picture, for the operations that need to refuse. */
const AUDIO_FIXTURE = path.join(FIXTURES, 'tone.m4a');
/**
 * HEVC, tagged hvc1, which is what an iPhone records. No mainstream browser
 * outside Safari decodes it, so this is the fixture for "the preview cannot
 * work and the operation still must".
 */
const HEVC_FIXTURE = path.join(FIXTURES, 'hevc-clip.mp4');
/** A second clip, visually distinct, for the operations that join files. */
const CLIP_B = path.join(FIXTURES, 'clip-b.mp4');
/** A tiny 64x64 PNG, for the watermark operation. */
const MARK = path.join(FIXTURES, 'mark.png');
/** A second tone. Two uploads of one file dedupe into one id, which would make a merge of one file twice. */
const TONE_B = path.join(FIXTURES, 'tone-b.m4a');

/** The rail, so "Convert" does not also match the audio one or a quick pick. */
const railLink = (page: Page, slug: string) => page.locator(`nav a[href="/op/${slug}"]`);

const commandText = async (page: Page): Promise<string> =>
  (await page.locator('code').innerText()).replace(/\s+/g, ' ');

async function loadFixture(page: Page): Promise<void> {
  await page.setInputFiles('input[type=file]', FIXTURE);
  /**
   * The video appearing is the signal that upload and probe both finished.
   * `.first()` because the crop panel draws the frame twice - once dimmed and
   * once clipped to the selection - so "the video" is ambiguous there.
   */
  await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * What Scrub actually wrote, read back with ffprobe.
 *
 * A run that exits zero is not proof of a usable file. Merge once produced
 * High 4:4:4 Predictive: ffmpeg called it success, Windows Media Player refused
 * to open it, and Chromium decoded it in software - so neither the exit code
 * nor the browser preview could have caught it. Only the file can.
 */
function probeNewestOutput(match: RegExp, fields: string): string {
  const workDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp');
  const newest = fs
    .readdirSync(workDir)
    .filter((name) => match.test(name))
    .map((name) => ({ name, at: fs.statSync(path.join(workDir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  if (!newest) throw new Error(`no output in .tmp matching ${String(match)}`);
  return execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      fields,
      '-of',
      'csv=p=0',
      path.join(workDir, newest.name),
    ],
    { encoding: 'utf8' },
  ).trim();
}

test.describe('loading a file', () => {
  test('uploads, probes, and shows what it found', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);

    const header = page.locator('header');
    await expect(header).toContainText('clip.mp4');
    // Straight from ffprobe, not from the filename.
    await expect(header).toContainText('320×180');
    await expect(header).toContainText('h264');

    // The home screen has to show the file, not fall back to the dropzone.
    await expect(page.getByText('Ready. Pick an operation.')).toBeVisible();
  });

  test('rejects a file ffmpeg cannot read, and says why', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type=file]', {
      name: 'not-really.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('this is text, not video'),
    });
    await expect(page.getByText(/could not read that file/i)).toBeVisible({ timeout: 20_000 });
    // ffprobe's own words, because a generic failure helps nobody.
    await expect(page.getByText(/Invalid data found/i)).toBeVisible();
  });

  test('keeps the file across navigation and a reload', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await railLink(page, 'compress').click();
    await railLink(page, 'trim').click();
    await expect(page.locator('video')).toBeVisible();

    await page.reload();
    await expect(page.locator('video')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('header')).toContainText('clip.mp4');
  });

  test('offers a way forward when landing on an operation with nothing loaded', async ({
    page,
  }) => {
    await page.goto('/op/gif');
    // Not a dead end reading "no file loaded".
    await expect(page.getByRole('button', { name: 'Choose a file' })).toBeVisible();
  });
});

test.describe('the command bar', () => {
  test('shows a real command built from the loaded file', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    const command = await commandText(page);
    expect(command).toContain('ffmpeg');
    // The real stored file, not a worked example about someone else's clip.
    expect(command).toContain('clip-');
    expect(command).toContain('-c copy');
  });

  test('follows the controls', async ({ page }) => {
    await page.goto('/op/compress');
    await loadFixture(page);

    expect(await commandText(page)).toContain('-crf 23');

    // The displayed value is typeable, not only draggable.
    const quality = page.getByLabel('Quality value');
    await quality.fill('31');
    await quality.blur();
    await expect.poll(async () => await commandText(page)).toContain('-crf 31');

    // And the readout says what the setting does to this file.
    await expect(page.getByText(/percent|depends on the picture/)).toBeVisible();
  });

  test('shows every pass of a two-pass operation', async ({ page }) => {
    await page.goto('/op/gif');
    await loadFixture(page);

    const passes = page.getByRole('group', { name: 'Which command to show' });
    await expect(passes.getByRole('button')).toHaveCount(2);

    /**
     * These were read as two actions to perform in order, which is a fair
     * reading of two numbered buttons sitting next to Run. They pick which
     * command is shown; Run executes both.
     */
    await expect(passes).toContainText('Showing');
    await expect(passes.getByRole('button').first()).toHaveAttribute(
      'title',
      /Run executes all 2, in order/,
    );

    expect(await commandText(page)).toContain('palettegen');
    await passes.getByRole('button', { name: /Show command 2 of 2/ }).click();
    await expect.poll(async () => await commandText(page)).toContain('paletteuse');
  });

  /**
   * The measurement pass used to report nothing at all, so a two-pass operation
   * that was explained in prose then showed no evidence the first pass had
   * happened - it read as though the correction had been guessed.
   */
  test('reports what the loudness measurement found', async ({ page }) => {
    await page.goto('/op/loudness');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/What the first command measured/)).toBeHidden();
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });

    // Scoped to the block itself rather than to a positional `dl`: it sits at
    // the top of the panel so it is on screen the moment the run ends.
    const block = page.getByText(/What the first command measured/).locator('..');
    await expect(block).toBeVisible();
    // ffmpeg's own numbers, not Scrub's arithmetic.
    await expect(block).toContainText('LUFS');
    await expect(block).toContainText('dBTP');
    await expect(block).toContainText('LU');
  });

  test('lints a hand-edited command and withholds Run on an error', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Edit the command' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit the command' });
    await editor.fill('ffmpeg -i in.mp4 -crg 23 -y out.mp4');

    await expect(page.getByText(/Did you mean "-crf"\?/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  test('offers a fix for -1 in a scale filter, and applies it', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Edit the command' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit the command' });
    await editor.fill('ffmpeg -i in.mp4 -vf scale=640:-1 -y out.mp4');

    await expect(page.getByText(/Use -2 rather than -1/)).toBeVisible();
    await page.getByRole('button', { name: 'Fix' }).first().click();
    await expect(editor).toHaveValue(/scale=640:-2/);
  });

  test('keeps an edit after the editor is closed', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Edit the command' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit the command' });
    await editor.fill(`${await editor.inputValue()} -metadata title=kept`);
    await page.getByRole('button', { name: /Stop editing/ }).click();

    await expect.poll(async () => await commandText(page)).toContain('title=kept');
    await expect(page.getByRole('button', { name: /Edited/ })).toBeVisible();
  });
});

test.describe('running an operation', () => {
  test('trims, reports progress, and offers the result', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await page.getByLabel('End timecode').fill('00:00:02.00');
    await page.getByLabel('End timecode').press('Enter');

    await page.getByRole('button', { name: 'Run' }).click();

    // The result panel takes over the well and owns saving the file.
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 60_000 });
    // The range is in the name, so a second trim of the same clip does not land
    // in the downloads folder as `clip-trim (1).mp4`.
    await expect(save).toHaveAttribute('download', 'clip-trim-0s-2s.mp4');
    // What was actually produced, next to what it came from.
    await expect(page.getByRole('button', { name: 'Original' })).toBeVisible();
  });

  /**
   * The command bar's one promise. It said `.mp4` for a WebM convert while
   * ffmpeg wrote `.webm`, so a command copied out of the bar would have written
   * VP9 and Opus into an MP4 - the extension is how ffmpeg picks its muxer.
   */
  test('shows the output path ffmpeg is actually given', async ({ page }) => {
    await page.goto('/op/convert');
    await loadFixture(page);
    // The radio itself is sr-only; the card around it is what a user clicks.
    await page.locator('label', { hasText: 'WebM' }).click();

    // The bar shows the working copy's path, which carries the upload suffix;
    // the saved name below is built from the name the user dropped in. The part
    // that has to agree is the extension, because that is the muxer.
    await expect(page.locator('code')).toContainText('-convert.webm');
    await expect(page.locator('code')).not.toContainText('-convert.mp4');

    await page.getByRole('button', { name: 'Run' }).click();
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 120_000 });
    await expect(save).toHaveAttribute('download', 'clip-convert.webm');
  });

  test('makes a GIF through both passes', async ({ page }) => {
    await page.goto('/op/gif');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Run' }).click();
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 90_000 });
    await expect(save).toHaveAttribute('download', /\.gif$/);
    // A GIF is a picture, so the result is shown as one rather than in a player.
    await expect(page.getByRole('img', { name: /Scrub produced/ })).toBeVisible();
  });

  test("surfaces ffmpeg's own words when a command fails", async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Edit the command' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit the command' });
    // Valid to the linter, impossible for ffmpeg: no such encoder.
    await editor.fill(
      (await editor.inputValue()).replace('-c copy', '-c:v libdefinitelynotacodec'),
    );
    await page.getByRole('button', { name: /Stop editing/ }).click();
    await page.getByRole('button', { name: 'Run' }).click();

    /**
     * Asserted on the contract rather than the wording. ffmpeg's return value
     * is a byte on some platforms and an AVERROR tag on others - Windows hands
     * back -1129203192 for a missing encoder - so the heading legitimately
     * differs. What must hold everywhere is that the failure announces itself
     * and carries ffmpeg's own last words.
     */
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(alert).toContainText(/ffmpeg (exited with code|stopped with an error)/);
    await expect(alert.locator('pre')).toContainText(
      /libdefinitelynotacodec|Unknown encoder|Encoder not found/,
    );
  });
});

test.describe('the workspace', () => {
  test('switches theme and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Dark' }).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  /**
   * Height, not just width. A laptop is defined by how short it is: 1366x768 is
   * still the most common screen there is, and after the browser's own chrome
   * that leaves about 625px of page. Checking three widths at a comfortable
   * 800px tall missed every problem that space actually causes.
   *
   * GIF is the worst case on purpose. It is a two-command operation, so the
   * command bar carries the pass switcher as well as everything else, and that
   * is what used to push Run off the right edge.
   */
  const SCREENS = [
    { width: 1920, height: 950, name: '1080p maximised' },
    { width: 1440, height: 790, name: 'MacBook Air 13' },
    { width: 1366, height: 625, name: '1366x768 laptop' },
    { width: 1280, height: 600, name: '720p laptop' },
    { width: 899, height: 700, name: 'just below the breakpoint' },
    { width: 640, height: 800, name: 'narrow' },
  ];

  for (const screen of SCREENS) {
    test(`lays out with nothing lost at ${String(screen.width)}x${String(screen.height)}, ${screen.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.goto('/op/gif');
      await loadFixture(page);

      const report = await page.evaluate(() => {
        const de = document.documentElement;
        const problems: string[] = [];
        if (de.scrollWidth - de.clientWidth > 1) {
          problems.push(`page scrolls sideways by ${String(de.scrollWidth - de.clientWidth)}px`);
        }

        // Nothing stacked vertically may sit on top of its next sibling. This is
        // how the result panel used to bury the operation's controls.
        const stack: Element[] = [document.querySelector('main') as Element];
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node || node instanceof SVGElement) continue;
          const kids = Array.from(node.children).filter((kid) => {
            if (kid instanceof SVGElement) return false;
            const style = getComputedStyle(kid);
            if (style.position === 'absolute' || style.position === 'fixed') return false;
            const box = kid.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          });
          // Walked pairwise rather than by index: `noUncheckedIndexedAccess`
          // makes every `kids[i]` possibly undefined, and a non-null assertion
          // in a test is exactly where a real undefined would hide.
          let previous: DOMRect | null = null;
          for (const kid of kids) {
            const box = kid.getBoundingClientRect();
            if (previous !== null) {
              const sideBySide = previous.right <= box.left + 1 || box.right <= previous.left + 1;
              if (!sideBySide && previous.bottom > box.top + 1) {
                problems.push(
                  `overlap of ${String(Math.round(previous.bottom - box.top))}px in the panel`,
                );
              }
            }
            previous = box;
          }
          for (const kid of kids) stack.push(kid);
        }
        return problems;
      });
      expect(report).toEqual([]);

      // Run is the point of the screen. It has to be on it.
      const run = page.getByRole('button', { name: 'Run' });
      const box = await run.boundingBox();
      expect(box, 'Run has no box').not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(screen.width + 1);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(screen.height + 1);

      // And every operation stays reachable, rail or scroller. Counted from the
      // list itself rather than a number that goes stale the next time one is
      // added - which is exactly what happened.
      await expect(page.locator('nav a')).toHaveCount(OPERATIONS.length);
    });
  }

  /** docs/DESIGN.md's quality floor: below 900px the filmstrip halves in height. */
  test('halves the filmstrip below the breakpoint', async ({ page }) => {
    const heightAt = async (width: number): Promise<number> => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/op/trim');
      await loadFixture(page);
      return page.getByRole('slider', { name: 'Start' }).evaluate((el) => {
        const track = el.parentElement;
        if (!track) throw new Error('the handle has no track');
        return Math.round(track.getBoundingClientRect().height);
      });
    };

    const wide = await heightAt(1440);
    const narrow = await heightAt(899);
    // A pixel of slack: these are laid out in rem and the halves land on .5.
    expect(
      Math.abs(narrow - wide / 2),
      `${String(wide)}px wide, ${String(narrow)}px narrow`,
    ).toBeLessThanOrEqual(1);
  });
});

test.describe('operations that do not fit the file', () => {
  /**
   * The silent-wrong-answer cases. ffmpeg ignores a scale filter on a file with
   * no video and reports success, so resizing an audio file used to hand back an
   * untouched copy and call it done.
   */
  test('withholds video operations from an audio file, and says why', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });

    await page.locator('nav a[href="/op/resize"]').click();
    await expect(page.getByText(/no video, so there is no picture/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  test('points a video at the operation that does what it means', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    // On a video, trimming the audio is trimming the video: same cut, same file.
    await page.locator('nav a[href="/op/audio-trim"]').click();
    await expect(page.getByText(/cuts the picture too/i)).toBeVisible();

    await page.getByRole('link', { name: /instead/ }).click();
    await expect(page).toHaveURL(/\/op\/trim$/);
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  test('still offers loudness on a video, which keeps the picture', async ({ page }) => {
    await page.goto('/op/loudness');
    await loadFixture(page);

    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
    expect(await commandText(page)).toContain('loudnorm');
  });
});

test.describe('a result that is no longer there', () => {
  /**
   * Working files expire on a TTL and are evicted against a size ceiling, so a
   * result can be swept while the panel offering it is still on screen.
   * `<a download>` cannot notice a 404: it saved the error body under the
   * output's name, so Save produced an 84-byte JSON file called
   * `clip-muted.mp4` and said nothing at all about it.
   */
  test('withdraws Save when the output has been swept', async ({ page }) => {
    await page.goto('/op/mute');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Run' }).click();

    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 60_000 });

    const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp');
    const swept = fs.readdirSync(tmp).find((name) => name.includes('-muted'));
    expect(swept, 'the output should be on disk before it is swept').toBeDefined();
    fs.rmSync(path.join(tmp, swept ?? ''));

    // Returning to the tab is what prompts the re-check.
    await page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });

    await expect(save).toBeHidden();
    // A regex for the apostrophe: the copy uses a typographic one.
    await expect(page.getByText(/no longer in Scrub.s working folder/)).toBeVisible();
    // The settings are untouched, so making another copy is one press.
    await expect(page.getByRole('button', { name: /run again/i })).toBeVisible();
  });
});

test.describe('motion', () => {
  /**
   * docs/DESIGN.md allows exactly one orchestrated moment, and these two tests are
   * the guard on both halves of the sentence describing it. The easy way to
   * lose either is a refactor that swaps the panels without the transition and
   * looks fine to whoever made the change, because they already knew a file had
   * landed.
   */
  test('sweeps the filmstrip in from the left as the frames decode', async ({ page }) => {
    await page.goto('/op/trim');

    const samples: string[] = [];
    await page.exposeFunction('__clip', (value: string) => {
      samples.push(value);
    });
    await page.evaluate(() => {
      const tick = (): void => {
        const img = document.querySelector('img[alt="Frames from the loaded video"]');
        if (img?.parentElement) void window.__clip(getComputedStyle(img.parentElement).clipPath);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await loadFixture(page);
    await expect(page.locator('img[alt="Frames from the loaded video"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(900);

    const distinct = [...new Set(samples)];
    // Covered at the start, uncovered at the end, and genuinely moving between.
    expect(distinct[0]).toContain('100%');
    expect(distinct[distinct.length - 1]).toContain('0%');
    expect(distinct.length).toBeGreaterThan(3);
  });

  test('drops the handoff to opacity when reduced motion is asked for', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/op/trim');

    const samples: string[] = [];
    await page.exposeFunction('__frame', (value: string) => {
      samples.push(value);
    });
    await page.evaluate(() => {
      const tick = (): void => {
        const el = document.querySelector('main div.relative > div');
        if (el) {
          const style = getComputedStyle(el);
          void window.__frame(`${style.opacity}|${style.transform}`);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await loadFixture(page);
    await page.waitForTimeout(1200);

    const transforms = new Set(samples.map((sample) => sample.split('|')[1]));
    const opacities = new Set(samples.map((sample) => sample.split('|')[0]));
    // Nothing moves, and the change is still visible.
    expect([...transforms]).toEqual(['none']);
    expect(opacities.size).toBeGreaterThan(2);

    await context.close();
  });
});

test.describe('a file the browser cannot preview', () => {
  /**
   * HEVC is the default on iPhone recordings and no mainstream browser outside
   * Safari decodes it. The operation still works; only the preview does not,
   * and saying which of the two has failed is the whole point of the message.
   */
  test('explains HEVC instead of showing a black rectangle', async ({ page }) => {
    await page.goto('/op/trim');
    await page.setInputFiles('input[type=file]', HEVC_FIXTURE);

    await expect(page.getByText(/Preview unavailable/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/HEVC/)).toBeVisible();
    // The message has to say the tool is not broken, or the user stops here.
    await expect(page.getByText(/Trimming still works/)).toBeVisible();
  });

  test('probes it correctly and still runs the operation', async ({ page }) => {
    await page.goto('/op/trim');
    await page.setInputFiles('input[type=file]', HEVC_FIXTURE);
    await expect(page.getByText(/Preview unavailable/)).toBeVisible({ timeout: 30_000 });

    // ffprobe read it even though the browser cannot play it.
    await expect(page.locator('header')).toContainText('hevc');
    await expect(page.locator('header')).toContainText('320');

    await page.getByRole('button', { name: 'Run' }).click();
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 60_000 });
    await expect(save).toHaveAttribute('download', /^hevc-clip-trim.*mp4$/);
  });

  test('still offers the operations, since only the preview is affected', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type=file]', HEVC_FIXTURE);
    await expect(page.getByText(/Preview unavailable/)).toBeVisible({ timeout: 30_000 });

    for (const slug of ['trim', 'compress', 'resize', 'gif', 'extract-audio']) {
      await expect(railLink(page, slug)).toBeVisible();
    }
  });
});

test.describe('cancelling', () => {
  /**
   * The fixture is three seconds at 320x180, and no built-in operation takes
   * long enough on it to cancel deterministically - compress at its slowest
   * preset finishes in about 200ms. So the run is made long by hand, through
   * the command bar, which is exactly what the command bar is for. `-stream_loop`
   * turns three seconds into a minute of encoding without another fixture.
   */
  test('stops the run and says nothing was written', async ({ page }) => {
    // Deliberately slow work, so the whole test needs more than the default budget.
    test.slow();
    await page.goto('/op/compress');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Edit the command' }).click();
    const editor = page.getByRole('textbox', { name: 'Edit the command' });
    const slow = (await editor.inputValue())
      .replace(' -i ', ' -stream_loop 60 -i ')
      .replace('-preset medium', '-preset veryslow');
    await editor.fill(slow);
    await page.getByRole('button', { name: /Stop editing/ }).click();
    /**
     * Wait for the bar to admit it is carrying an edit before pressing Run.
     * Without this the click can land on the generated command, which finishes
     * in about 200ms - so the run was over before Cancel was pressed and the
     * test failed for a reason that had nothing to do with cancelling.
     */
    await expect(page.getByRole('button', { name: /Edited/ })).toBeVisible();

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // The kill is immediate; measured at about 30ms.
    await expect(page.getByText(/Cancelled\. Nothing was written\./)).toBeVisible({
      timeout: 15_000,
    });
    // No half-written file is offered for saving.
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeHidden();
    // And Run comes back, rather than leaving a dead progress bar behind.
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  });
});

test.describe('replace audio', () => {
  /**
   * The only operation that takes a second file. Its panel is its own drop
   * target and stops propagation on drop, because the window-wide target would
   * otherwise read a dropped audio file as "replace the video I am working on".
   */
  test('takes a second file and maps both inputs', async ({ page }) => {
    await page.goto('/op/replace-audio');
    await loadFixture(page);

    // Nothing to build a command from until a track is chosen.
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();

    await page.locator('input[type=file]').last().setInputFiles(AUDIO_FIXTURE);
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 30_000 });

    const command = await commandText(page);
    expect(command).toContain('-map 0:v:0');
    expect(command).toContain('-map 1:a:0');
    // The picture is never re-encoded to change the sound.
    expect(command).toContain('-c:v copy');
    // The result takes the shorter of the two lengths.
    expect(command).toContain('-shortest');

    await page.getByRole('button', { name: 'Run' }).click();
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 90_000 });
    await expect(save).toHaveAttribute('download', 'clip-new-audio.mp4');
  });

  test('refuses a replacement with no audio track', async ({ page }) => {
    await page.goto('/op/replace-audio');
    await loadFixture(page);

    // The refusal belongs at the picker, not at Run.
    await page
      .locator('input[type=file]')
      .last()
      .setInputFiles({
        name: 'not-audio.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('this is not a media file'),
      });

    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled({ timeout: 30_000 });
  });
});

test.describe('the working folder', () => {
  test('reports what is on disk and clears it on request', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Working files')).toBeVisible();
    // A loaded file means at least one file and a non-zero size.
    await expect(page.getByText(/(KB|MB|GB) in \d+ files?/)).toBeVisible();
    // The ceiling is stated, not just enforced silently.
    await expect(page.getByText(/Cleared automatically past/)).toBeVisible();

    /**
     * "Clear all but this file" rather than "Clear now": the obvious moment to
     * free space is while looking at a file you are working on, and losing it
     * would be a strange reward for tidying up.
     */
    const clear = page.getByRole('button', { name: /Clear all but this file/ });
    await expect(clear).toBeEnabled();
    await clear.click();

    // The file on screen survives, so the preview is still there afterwards.
    await page.keyboard.press('Escape');
    await expect(page.locator('video')).toBeVisible();
  });
});

test.describe('dropping the same file twice', () => {
  /**
   * Re-dropping a clip used to copy it again. One session of ordinary testing
   * left 125 copies of one file on disk, which is the kind of waste nobody
   * notices until the disk is full.
   */
  test('recognises it and does not copy it again', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);
    const first = await commandText(page);

    await page.getByRole('button', { name: 'Close file' }).click();
    await expect(page.getByText('Drop a video or audio file')).toBeVisible();

    await loadFixture(page);
    const second = await commandText(page);

    // The same working copy, so the same path in the command.
    expect(second).toBe(first);
  });
});

test.describe('the keyboard', () => {
  /**
   * docs/DESIGN.md's quality floor names these explicitly. They are also the most
   * fragile thing in the app: a focused `<video controls>` answers Space and the
   * arrows from the browser's own shadow DOM, which the page cannot cancel even
   * from a capture listener. That bug has been here once already.
   */
  const timeOf = async (page: Page): Promise<number> =>
    page.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime);

  const seekTo = async (page: Page, seconds: number): Promise<void> => {
    await page.locator('video').evaluate((el: HTMLVideoElement, to: number) => {
      el.currentTime = to;
    }, seconds);
    await expect.poll(async () => timeOf(page)).toBeGreaterThan(seconds - 0.2);
  };

  test('sets in and out points with the bracket keys', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await seekTo(page, 1);
    await page.keyboard.press('[');
    await expect
      .poll(async () => page.getByLabel('Start timecode').inputValue())
      .not.toBe('00:00:00.00');

    await seekTo(page, 2);
    await page.keyboard.press(']');
    await expect
      .poll(async () => page.getByLabel('End timecode').inputValue())
      .not.toBe('00:00:03.00');

    // And the command follows, which is the point of setting them at all.
    expect(await commandText(page)).toContain('-ss');
  });

  test('plays and pauses with the space bar', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    const paused = async (): Promise<boolean> =>
      page.locator('video').evaluate((el: HTMLVideoElement) => el.paused);
    expect(await paused()).toBe(true);

    await page.keyboard.press('Space');
    await expect.poll(paused).toBe(false);

    await page.keyboard.press('Space');
    await expect.poll(paused).toBe(true);
  });

  test('nudges by a frame with an arrow and by a second with shift', async ({ page }) => {
    await page.goto('/op/trim');
    await loadFixture(page);

    await seekTo(page, 1.5);
    const before = await timeOf(page);

    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => timeOf(page)).toBeGreaterThan(before);
    const afterFrame = await timeOf(page);
    // One frame, not one second.
    expect(afterFrame - before).toBeLessThan(0.2);

    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => timeOf(page)).toBeGreaterThan(afterFrame + 0.5);
  });
});

test.describe('fitting a size', () => {
  /**
   * "Under 10 MB" is the most common thing anyone asks a video tool for, and
   * compress could not answer it: CRF asks how good, not how big. The test that
   * matters is not that a command was produced, it is that the file on disk is
   * actually under the limit.
   */
  test('produces a file under the limit it was aimed at', async ({ page }) => {
    test.slow();
    await page.goto('/op/target-size');
    await loadFixture(page);

    // Discord is the default preset: a 10 MB cap, aimed at 9.5.
    await expect(page.getByText(/Discord raised the free limit/)).toBeVisible();

    const command = await commandText(page);
    expect(command).toContain('-pass 1');
    expect(command).toContain('-b:v');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const save = page.getByRole('link', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 120_000 });
    await expect(save).toHaveAttribute('download', /fit-9-5mb/);

    const href = await save.getAttribute('href');
    const response = await page.request.get(`http://localhost:5173${href ?? ''}`);
    const bytes = (await response.body()).length;
    expect(bytes, 'the whole point is that it clears the limit').toBeLessThan(10 * 1024 * 1024);
  });

  /**
   * The refusal - "this length will not fit in that size, here is what would" -
   * is covered in shared/src/size-presets.test.ts and build-operations.test.ts
   * rather than here. The committed fixture is three seconds long and makes
   * even a 0.5 MB target comfortably, so provoking the refusal end to end would
   * mean committing a much longer file for one assertion.
   */
});

test.describe('speed', () => {
  test('changes the length and keeps the sound with it', async ({ page }) => {
    await page.goto('/op/speed');
    await loadFixture(page);

    const command = await commandText(page);
    // Both filters, or the result drifts out of sync as it plays.
    expect(command).toContain('setpts=PTS/2');
    expect(command).toContain('atempo=2');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toHaveAttribute(
      'download',
      'clip-speed-2x.mp4',
    );
  });
});

test.describe('crop', () => {
  test('crops to the rectangle, in even numbers', async ({ page }) => {
    await page.goto('/op/crop');
    await loadFixture(page);

    await expect(page.getByRole('group', { name: 'Crop rectangle' })).toBeVisible();

    // A preset rectangle rather than a synthetic drag: the arithmetic is the
    // part worth testing, and the corners have their own keyboard test below.
    await page.getByRole('button', { name: '16:9' }).click();

    const command = await commandText(page);
    const [, w, h, x, y] = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(command) ?? [];
    for (const value of [w, h, x, y]) {
      // libx264 needs even dimensions, and an odd offset smears the chroma.
      expect(Number(value) % 2, `${String(value)} should be even`).toBe(0);
    }

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
  });

  test('moves a corner with the arrow keys', async ({ page }) => {
    await page.goto('/op/crop');
    await loadFixture(page);

    const before = await commandText(page);
    await page.getByRole('button', { name: 'Top left corner' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect.poll(async () => commandText(page)).not.toBe(before);
  });
});

test.describe('the queue', () => {
  /**
   * The point is that starting one encode does not trap you watching it. Before
   * this, moving to another operation reset the run state and the encode
   * carried on invisibly.
   */
  test('keeps a second job behind the first and shows both', async ({ page }) => {
    test.slow();
    await page.goto('/op/compress');
    await loadFixture(page);

    /**
     * No assertion that the strip starts empty. Jobs belong to the server and
     * every test in this file shares one, so earlier tests leave finished chips
     * behind - which is the behaviour, not a leak: the queue is rebuilt from the
     * server on load and keeps the last few.
     */
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    // In-app navigation, the way the rail actually works.
    await railLink(page, 'crop').click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    // Both are tracked, whichever of them is running at this instant.
    await expect(page.getByText(/Compress · clip\.mp4/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Crop · clip\.mp4/).first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('Clear finished')).toBeVisible({ timeout: 120_000 });
    await page.getByText('Clear finished').click();
    await expect(page.getByText(/Compress · clip\.mp4/)).toHaveCount(0);
  });
});

test.describe('carrying a result forward', () => {
  /**
   * Trim then compress is two operations on one file. Without this the second
   * meant saving the first result and dropping it back in by hand.
   */
  test('uses a result as the next source, only when asked', async ({ page }) => {
    test.slow();
    await page.goto('/op/trim');
    await loadFixture(page);
    await page.getByLabel('End timecode').fill('00:00:02.00');
    await page.getByLabel('End timecode').press('Enter');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole('button', { name: /Keep working on this/ }).click();

    await railLink(page, 'compress').click();
    // The command for the next operation is built from the trimmed file, and
    // the name carries the whole chain.
    await expect.poll(async () => commandText(page)).toContain('trim-0s-2s');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toHaveAttribute(
      'download',
      'clip-trim-0s-2s-compress-crf23.mp4',
    );
  });
});

test.describe('remembering how you like things', () => {
  test('keeps a setting across a reload', async ({ page }) => {
    await page.goto('/op/compress');
    await loadFixture(page);

    await page.getByLabel('Quality value').fill('29');
    await page.getByLabel('Quality value').press('Enter');
    await expect.poll(async () => commandText(page)).toContain('-crf 29');

    await page.reload();
    await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });

    // Asked once, not every visit.
    await expect.poll(async () => commandText(page)).toContain('-crf 29');

    // Put it back, so the next test does not inherit it.
    await page.getByLabel('Quality value').fill('23');
    await page.getByLabel('Quality value').press('Enter');
  });
});

test.describe('the rail on a short screen', () => {
  /**
   * Fourteen operations used to fit a 1366x768 laptop's rail, roughly 478px.
   * The merge suite made it twenty-four entries, which can never fit that
   * budget at any legible density, so the contract changed: the most common
   * laptop gets a rail that says there is more, and every operation is one
   * scroll away. An operation that exists must never look like one that does
   * not.
   */
  test('marks the rail as scrollable on the most common laptop, and the last operation is reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 625 });
    await page.goto('/op/trim');

    // The list genuinely does not fit, so the sticky fade says so.
    await expect(page.locator('nav div[aria-hidden].sticky')).toBeAttached();

    const reached = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      if (!nav) return null;
      nav.scrollTop = nav.scrollHeight;
      const links = Array.from(nav.querySelectorAll('a'));
      const last = links[links.length - 1];
      if (!last) return null;
      return last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom + 1;
    });
    expect(reached).toBe(true);
  });

  /** Shorter than that it genuinely does not fit, and has to say so. */
  test('marks the list as scrollable when it truly does not fit', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 460 });
    await page.goto('/op/trim');
    await expect(page.locator('nav div[aria-hidden].sticky')).toBeAttached();
  });
});

test.describe('pointing at the other operation', () => {
  /**
   * Compress spends a paragraph explaining that it cannot give you a size. The
   * person reading that is exactly the person who wants Fit a size, and nothing
   * used to tell them it was there.
   */
  test('compress links to Fit a size', async ({ page }) => {
    await page.goto('/op/compress');
    await loadFixture(page);

    // Scoped to the panel: the rail has a link of the same name, which is the
    // point of the rail.
    const link = page.getByRole('main').getByRole('link', { name: 'Fit a size' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: 'Fit a size' })).toBeVisible();
  });
});

test.describe('running from the keyboard', () => {
  test('Ctrl and Return starts the run', async ({ page }) => {
    await page.goto('/op/mute');
    await loadFixture(page);

    await page.keyboard.press('Control+Enter');

    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('does nothing when there is nothing to run', async ({ page }) => {
    await page.goto('/op/mute');
    await page.keyboard.press('Control+Enter');
    // Still the empty state, and nothing started: no progress bar appeared.
    // Not asserted against the queue strip, which may hold chips from earlier
    // tests in this file - they share one server.
    await expect(page.getByText(/Drop a file to mute/)).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  });
});

test.describe('the queue after a reload', () => {
  /**
   * Jobs run in the server process and keep going whatever the browser does. A
   * refresh mid-encode used to lose sight of work that was still happening, and
   * the output appeared in the working folder later with nothing having said so.
   */
  test('comes back, with what finished while the page was away', async ({ page }) => {
    test.slow();
    await page.goto('/op/compress');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByText(/Compress · clip\.mp4/).first()).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });

    // The job is the server's, so it survived the page.
    await expect(page.getByText(/Compress · clip\.mp4/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Clear finished')).toBeVisible({ timeout: 120_000 });
  });
});

test.describe('picking a file up again', () => {
  /**
   * A clip that was open a few minutes ago is still on disk, probed, with its
   * filmstrip already drawn. Uploading it again is waiting for something that
   * has already happened.
   */
  test('offers a file still in the working folder, and loads it', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Close file' }).click();
    await expect(page.getByText('Drop a video or audio file')).toBeVisible();

    /**
     * Scoped to the dropzone: the queue strip also holds chips named after the
     * same file, because they are jobs that ran on it.
     */
    const recent = page
      .getByRole('main')
      .getByRole('button', { name: /clip\.mp4/ })
      .first();
    await expect(recent).toBeVisible({ timeout: 30_000 });
    await recent.click();

    // Loaded without a second upload: straight to the workspace.
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('header')).toContainText('clip.mp4');
  });
});

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
    if (strip === null) throw new Error('the rail rendered with no bounding box');
    // Wide and short: the strip. The vertical rail is tall and narrow.
    expect(strip.width).toBeGreaterThan(strip.height * 4);
    // The group legends belong to the vertical rail. In the strip they used
    // to leak back in with their column margins, sitting at odd heights.
    await expect(rail.getByText('Video', { exact: true })).toHaveCount(0);
    await expect(rail.getByText('Audio', { exact: true })).toHaveCount(0);

    // Light restores the vertical rail.
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    const column = await rail.boundingBox();
    if (column === null) throw new Error('the rail rendered with no bounding box');
    expect(column.height).toBeGreaterThan(column.width);
  });

  test('turns the command bar into a prompt with a block cursor', async ({ page }) => {
    await switchToTube(page);
    await expect(page.getByText('scrub$')).toBeVisible();
    await expect(page.locator('code .cursor-block')).toBeVisible();
  });

  test('shows scanlines on the empty well and clears them once a file loads', async ({ page }) => {
    await switchToTube(page);
    await expect(page.locator('.scanlines')).toBeVisible();

    await loadFixture(page);
    await expect(page.locator('.scanlines')).toHaveCount(0);
  });
});

test.describe('the landing page', () => {
  /**
   * The invitation to drop a file is the whole screen on this route, so it has to
   * fill the panel whether or not the working folder has anything to offer.
   *
   * It did not. `main` is a block container, so the wrapper's `flex-1` had nothing
   * to stretch against and the box sat at its `min-h` floor, which on a 1366x768
   * laptop is less than half the space. The recent-files list padded it out and
   * hid that completely, until the folder was emptied and the list went away.
   */
  test('the dropzone fills the panel, with or without recent files', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');

    const fill = await page.evaluate(() => {
      const zone = document.querySelector('[class*="border-dashed"]');
      const main = document.querySelector('main');
      if (!zone || !main) return null;
      const style = getComputedStyle(main);
      // Main's content box, which is what a full-height child should occupy.
      const inner =
        main.getBoundingClientRect().height -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom);
      return { zone: zone.getBoundingClientRect().height, inner };
    });

    if (fill === null) throw new Error('no dropzone on the landing page');
    // A pixel of slack: subpixel layout, not a gap.
    expect(fill.inner - fill.zone).toBeLessThanOrEqual(1);
  });

  /**
   * The picture must not decide how tall the well is.
   *
   * The video was `w-full`, so its height followed from its aspect ratio, and a
   * flex item will not shrink below its content. A 16:9 clip in a wide panel
   * therefore made a well taller than the window: 953px on a 1920x937 laptop,
   * which pushed the next step off the screen on every size of laptop, and the
   * controls off the operation pages with it. Chromium decodes a 16:9 frame
   * happily at any of these sizes, so only a measurement catches it.
   */
  test('the preview well never grows taller than the panel, at any laptop size', async ({
    page,
  }) => {
    for (const size of [
      { width: 1920, height: 937 },
      { width: 1536, height: 749 },
      { width: 1280, height: 624 },
      { width: 1366, height: 625 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/op/trim');
      await loadFixture(page);
      await page.waitForTimeout(600);

      const measured = await page.evaluate(() => {
        const main = document.querySelector('main');
        const well = document.querySelector('[class*="rounded-well"]');
        if (!main || !well) return null;
        return {
          well: well.getBoundingClientRect().height,
          main: main.getBoundingClientRect().height,
        };
      });

      if (measured === null) throw new Error('no well on the trim page');
      expect(
        measured.well,
        `well ${String(Math.round(measured.well))}px vs panel ${String(Math.round(measured.main))}px at ${String(size.width)}x${String(size.height)}`,
      ).toBeLessThanOrEqual(measured.main);
    }
  });

  /**
   * And the consequence on this route: the line that says what to do next has to
   * be readable without hunting for it.
   */
  test('shows the next step after loading, without scrolling', async ({ page }) => {
    for (const size of [
      { width: 1920, height: 937 },
      { width: 1280, height: 624 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/');
      await page.evaluate(() => {
        sessionStorage.clear();
      });
      await page.reload();
      await loadFixture(page);
      await page.waitForTimeout(900);

      const card = page.getByText('Ready. Pick an operation.');
      await expect(card).toBeVisible();
      const below = await card.evaluate(
        (node) => node.getBoundingClientRect().bottom > window.innerHeight,
      );
      expect(below, `the next step was below the fold at ${String(size.width)} wide`).toBe(false);
    }
  });
});

test.describe('the merge suite', () => {
  /**
   * Adds an extra input by clicking the Inputs card's own drop zone and feeding
   * the file chooser. `setInputFiles` on the raw selector is a trap here: the
   * empty-state dropzone lingers in the DOM through its exit animation, and
   * Playwright silently targets the first matching input, which would replace
   * the loaded file instead of joining it.
   */
  const addExtra = async (page: Page, zoneText: string, filePath: string): Promise<void> => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByText(zoneText).click();
    await (await chooser).setFiles(filePath);
  };

  test('merges two clips with a crossfade', async ({ page }) => {
    await page.goto('/op/merge');
    await loadFixture(page);
    await addExtra(page, 'Drop or click to add a clip. The loaded file goes first.', CLIP_B);

    await expect(page.locator('ol li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });

    // The bar showed the real graph: crossfade on both streams.
    const command = await commandText(page);
    expect(command).toContain('xfade=transition=fade');
    expect(command).toContain('acrossfade');

    /**
     * And the file it wrote is one other players will open. xfade offers
     * libx264 a wider pixel format than the clips had, and taking it produces
     * a 4:4:4 file that no hardware decoder anywhere will touch.
     */
    const probed = probeNewestOutput(/-merge-.*\.mp4$/, 'stream=profile,pix_fmt');
    expect(probed).toContain('yuv420p');
    expect(probed).not.toContain('4:4:4');
  });

  test('merges two songs', async ({ page }) => {
    await page.goto('/op/merge-audio');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });
    await addExtra(page, 'Drop or click to add a song. The loaded file goes first.', TONE_B);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
  });

  test('puts music under a video', async ({ page }) => {
    await page.goto('/op/add-music');
    await loadFixture(page);
    await addExtra(page, 'Drop or click to add a music file.', AUDIO_FIXTURE);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('amix=inputs=2');
  });

  test('stamps an image over the picture', async ({ page }) => {
    await page.goto('/op/watermark');
    await loadFixture(page);
    await addExtra(page, 'Drop or click to add an image.', MARK);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('overlay=');
  });

  test('fades, loops, and turns the volume up', async ({ page }) => {
    await page.goto('/op/fade');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('fade=t=in');

    await page.goto('/op/loop');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('-stream_loop');

    await page.goto('/op/volume');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('volume=6dB');
  });

  test('points audio files at the audio variants', async ({ page }) => {
    await page.goto('/op/merge');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/joining songs/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use merge audio instead' })).toBeVisible();
  });

  test('saves the frame under the playhead', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Save this frame' }).click();
    // Queue chips name their Save link "Save <filename>", unlike the result
    // panel's bare Save.
    await expect(page.getByRole('link', { name: /Save .*frame-.*\.png/ })).toBeVisible({
      timeout: 60_000,
    });
    // The queue recorded it as a Frame job.
    await expect(page.getByText(/Frame ·/)).toBeVisible();
  });
});

test.describe('the annotated sliders', () => {
  /**
   * A tick label names a position on the scale, and the ones at either end name
   * the ends. Centring every label on its own position put half of "hard cut"
   * outside the panel, because the position it names is the very start of the
   * track. Every tick set before the merge suite happened to sit comfortably
   * inside its range, so nothing caught it.
   */
  const escapedLabels = (page: Page) =>
    page.evaluate(() => {
      const escaped: { label: string; left: number; right: number }[] = [];
      for (const slider of Array.from(document.querySelectorAll('input[type=range]'))) {
        const track = slider.parentElement;
        const field = track?.parentElement;
        if (!track || !field) continue;
        const bounds = field.getBoundingClientRect();
        for (const tick of Array.from(track.querySelectorAll('span'))) {
          const rect = tick.getBoundingClientRect();
          const left = bounds.left - rect.left;
          const right = rect.right - bounds.right;
          // A pixel of slack: subpixel layout, not an escape.
          if (left > 1 || right > 1) {
            escaped.push({ label: tick.textContent, left, right });
          }
        }
      }
      return escaped;
    });

  test('keeps every tick label inside its own field', async ({ page }) => {
    // Merge puts ticks on both ends of the crossfade scale, and Loop pairs that
    // with the longest label in the product.
    await page.goto('/op/merge');
    await loadFixture(page);
    expect(await escapedLabels(page)).toEqual([]);

    await page.goto('/op/loop');
    await expect(page.locator('input[type=range]').first()).toBeVisible();
    expect(await escapedLabels(page)).toEqual([]);
  });
});
