import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import type { FfmpegTool } from './locate.js';

/**
 * Frames across the whole timeline. Enough that each is roughly a thumbnail at
 * the widths Scrub runs at, few enough that one decode pass stays quick.
 */
export const FRAME_COUNT = 40;

/** Native height of each frame. Width follows the aspect ratio via `-2`. */
export const FRAME_HEIGHT = 64;

/**
 * One strip per upload, generated once.
 *
 * Two requests for the same file arriving together share the same promise —
 * without that, opening Trim twice in quick succession would start two full
 * decode passes over the same video.
 */
const inFlight = new Map<string, Promise<string>>();

export class FilmstripFailed extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'FilmstripFailed';
    this.stderr = stderr;
  }
}

export async function filmstripFor(
  ffmpeg: FfmpegTool,
  id: string,
  sourcePath: string,
  durationSec: number,
): Promise<string> {
  const target = path.join(config.tmpDir, `filmstrip-${id}.jpg`);

  // Already built, and the sweeper has not been through.
  try {
    await fs.access(target);
    return target;
  } catch {
    // Not built yet; fall through and build it.
  }

  const existing = inFlight.get(id);
  if (existing) return existing;

  const build = generate(ffmpeg, sourcePath, target, durationSec).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, build);
  return build;
}

/**
 * One image holding every frame side by side, rather than forty separate files.
 *
 * `tile` is what makes that possible, and it is worth the filter: the client
 * loads a single image instead of forty requests, and the strip can then be
 * positioned with CSS rather than assembled in the DOM.
 *
 * `fps=count/duration` spreads the samples evenly across the whole timeline. The
 * decode is the expensive part — ffmpeg has to walk the file to land on evenly
 * spaced times — so this is cached per upload.
 */
async function generate(
  ffmpeg: FfmpegTool,
  sourcePath: string,
  target: string,
  durationSec: number,
): Promise<string> {
  // Guard against a zero or absurd rate on very short clips.
  const rate = Math.max(FRAME_COUNT / Math.max(durationSec, 0.1), 0.001);

  const argv = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    sourcePath,
    '-vf',
    `fps=${rate.toFixed(6)},scale=-2:${String(FRAME_HEIGHT)},tile=${String(FRAME_COUNT)}x1`,
    '-frames:v',
    '1',
    // The strip is decoration for a timeline; quality beyond this is bytes the
    // browser has to download for no visible gain.
    '-q:v',
    '6',
    '-an',
    '-y',
    target,
  ];

  const { code, stderr } = await run(ffmpeg.path, argv);
  if (code !== 0) {
    throw new FilmstripFailed(`ffmpeg exited ${String(code)}`, stderr);
  }
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
