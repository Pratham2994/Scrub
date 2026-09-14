import { buildArgs, type CommandIo, type ProbeResult } from '@scrub/shared';

/**
 * The dimmed command on the empty state.
 *
 * Built by calling the real `buildArgs` rather than typing a plausible-looking
 * string, so the first thing a user sees is genuinely what Scrub produces — and so
 * the shared package is proven to be wired into the client at render time.
 */
const sampleMeta: ProbeResult = {
  path: 'holiday-clip.mp4',
  displayName: 'holiday-clip.mp4',
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 612.48,
  sizeBytes: 148_922_112,
  bitrate: 1_945_600,
  video: { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 29.97, pixelFormat: 'yuv420p' },
  audio: { index: 1, codec: 'aac', channels: 2, sampleRate: 48_000 },
};

const sampleIo: CommandIo = {
  inputPath: 'holiday-clip.mp4',
  outputPath: 'holiday-clip-trimmed.mp4',
  workDir: '.',
};

const samplePlan = buildArgs(
  { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'fast' },
  sampleMeta,
  sampleIo,
);

const [firstPass] = samplePlan.passes;
if (!firstPass) {
  throw new Error('buildArgs returned a plan with no passes for the sample trim');
}

export const SAMPLE_ARGV: readonly string[] = firstPass.argv;
