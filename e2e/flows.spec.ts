import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

/**
 * End-to-end coverage of the flows that matter, against a real ffmpeg.
 *
 * These are deliberately not mocked. The whole product is "the command Scrub
 * shows is the command that runs", and a suite that stubbed the server out
 * would be testing the one half of that claim which was never in doubt.
 *
 * The fixture is three seconds at 320x180 and about 47 kB — small enough to
 * commit, real enough to encode.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE = path.join(FIXTURES, 'clip.mp4');
/** Audio with no picture, for the operations that need to refuse. */
const AUDIO_FIXTURE = path.join(FIXTURES, 'tone.m4a');

/** The rail, so "Convert" does not also match the audio one or a quick pick. */
const railLink = (page: Page, slug: string) => page.locator(`nav a[href="/op/${slug}"]`);

const commandText = async (page: Page): Promise<string> =>
  (await page.locator('code').innerText()).replace(/\s+/g, ' ');

async function loadFixture(page: Page): Promise<void> {
  await page.setInputFiles('input[type=file]', FIXTURE);
  // The video appearing is the signal that upload and probe both finished.
  await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
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

    const passes = page.getByRole('group', { name: 'Command passes' });
    await expect(passes.getByRole('button')).toHaveCount(2);

    expect(await commandText(page)).toContain('palettegen');
    await passes.getByRole('button', { name: /2\./ }).click();
    await expect.poll(async () => await commandText(page)).toContain('paletteuse');
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
    const save = page.getByRole('link', { name: 'Save' });
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
   * VP9 and Opus into an MP4 — the extension is how ffmpeg picks its muxer.
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
    const save = page.getByRole('link', { name: 'Save' });
    await expect(save).toBeVisible({ timeout: 120_000 });
    await expect(save).toHaveAttribute('download', 'clip-convert.webm');
  });

  test('makes a GIF through both passes', async ({ page }) => {
    await page.goto('/op/gif');
    await loadFixture(page);

    await page.getByRole('button', { name: 'Run' }).click();
    const save = page.getByRole('link', { name: 'Save' });
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

    await expect(page.getByText(/ffmpeg exited with code/)).toBeVisible({ timeout: 60_000 });
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

  test('never scrolls sideways, at any supported width', async ({ page }) => {
    for (const width of [1440, 900, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/op/trim');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${String(width)}px`).toBeLessThanOrEqual(0);
    }
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

    const save = page.getByRole('link', { name: 'Save' });
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
   * DESIGN.md allows exactly one orchestrated moment, and these two tests are
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
