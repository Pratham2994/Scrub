import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import type { FfmpegTool } from './locate.js';

/**
 * The waveform, rendered by ffmpeg rather than in the browser.
 *
 * DESIGN.md names Wavesurfer for this, and the reason for not using it is
 * mechanical: Wavesurfer downloads and decodes the whole file in the page. That
 * is fine for a thirty-second clip and ruinous for a two-hour recording, which
 * would mean sending the entire file to the browser a second time and decoding
 * it on the main thread.
 *
 * ffmpeg's `showwavespic` draws the same picture on the machine that already has
 * the file, and the result is one cached image positioned with CSS. It is the
 * same shape as the filmstrip, for the same reasons.
 */
export const WAVEFORM_WIDTH = 1600;
export const WAVEFORM_HEIGHT = 96;

/** Shared with the filmstrip: two requests for one file must not decode twice. */
const inFlight = new Map<string, Promise<string>>();

export class WaveformFailed extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'WaveformFailed';
    this.stderr = stderr;
  }
}

export async function waveformFor(
  ffmpeg: FfmpegTool,
  id: string,
  sourcePath: string,
): Promise<string> {
  const target = path.join(config.tmpDir, `waveform-${id}.png`);

  try {
    await fs.access(target);
    return target;
  } catch {
    // Not built yet.
  }

  const existing = inFlight.get(id);
  if (existing) return existing;

  const build = generate(ffmpeg, sourcePath, target).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, build);
  return build;
}

async function generate(ffmpeg: FfmpegTool, sourcePath: string, target: string): Promise<string> {
  const argv = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    sourcePath,
    '-filter_complex',
    [
      // One combined channel. Split channels look busier without telling the
      // user anything more about where the sound is.
      `aformat=channel_layouts=mono`,
      /**
       * `scale=cbrt`, chosen by measuring rather than by taste.
       *
       * A linear waveform of anything quietly recorded is a flat line. On a
       * track peaking around -22 dB, the drawn shape covered 2% of the height
       * with `lin`, 13% with `sqrt` and 26% with `cbrt`, while `log` reached
       * 61% but flattened loud material into a solid block.
       *
       * This picture exists so someone can see where the sound is and cut on a
       * peak, so visibility on quiet material matters, and so does keeping the
       * envelope readable on ordinary material. `cbrt` is the setting that does
       * both.
       */
      `showwavespic=s=${String(WAVEFORM_WIDTH)}x${String(WAVEFORM_HEIGHT)}:colors=0xE7E9EC:scale=cbrt`,
    ].join(','),
    '-frames:v',
    '1',
    // PNG, because the waveform is drawn on transparency and sits over the well.
    '-y',
    target,
  ];

  const { code, stderr } = await run(ffmpeg.path, argv);
  if (code !== 0) throw new WaveformFailed(`ffmpeg exited ${String(code)}`, stderr);
  return target;
}

function run(
  binary: string,
  args: readonly string[],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Argument array, no shell. Same rule as every other spawn in Scrub.
    const child = spawn(binary, [...args], { shell: false, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}
