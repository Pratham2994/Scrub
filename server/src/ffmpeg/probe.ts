import { spawn } from 'node:child_process';
import path from 'node:path';

import type { ProbeAudioStream, ProbeResult, ProbeVideoStream } from '@scrub/shared';
import { z } from 'zod';

import type { FfmpegTool } from './locate.js';

/**
 * ffprobe emits numbers as strings in JSON, and omits anything it could not
 * determine. The schema mirrors that rather than pretending otherwise, and the
 * conversion to real numbers happens once, here.
 */
const rawStreamSchema = z.object({
  index: z.number(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  r_frame_rate: z.string().optional(),
  pix_fmt: z.string().optional(),
  channels: z.number().optional(),
  sample_rate: z.string().optional(),
});

const rawProbeSchema = z.object({
  format: z.object({
    format_name: z.string().optional(),
    duration: z.string().optional(),
    size: z.string().optional(),
    bit_rate: z.string().optional(),
  }),
  streams: z.array(rawStreamSchema),
});

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ffprobe reports frame rate as a rational string, e.g. "30000/1001" for 29.97. */
function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const [num, den] = value.split('/');
  const n = Number.parseFloat(num ?? '');
  const d = Number.parseFloat(den ?? '1');
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return Math.round((n / d) * 100) / 100;
}

export class ProbeFailed extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'ProbeFailed';
    this.stderr = stderr;
  }
}

/**
 * Read a media file's real shape. Everything downstream — the duration the
 * scrubber spans, the codec the preview needs, the dimensions a resize starts
 * from — comes from here, so a file that will not probe is a file Scrub refuses
 * rather than guesses about.
 */
export async function probeFile(
  ffprobe: FfmpegTool,
  filePath: string,
  displayName: string,
): Promise<ProbeResult> {
  const { stdout, stderr, code } = await run(ffprobe.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  if (code !== 0) {
    throw new ProbeFailed(`ffprobe exited ${String(code)}`, stderr);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ProbeFailed('ffprobe did not return JSON', stderr);
  }

  const result = rawProbeSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProbeFailed('ffprobe returned an unexpected shape', stderr);
  }

  const { format, streams } = result.data;
  const rawVideo = streams.find((s) => s.codec_type === 'video');
  const rawAudio = streams.find((s) => s.codec_type === 'audio');

  // A cover-art JPEG inside an mp3 is a "video" stream with no frame rate. Treating
  // it as video would put a still image in the well and offer a resize on an
  // audio file, so it is only a video stream if it actually has dimensions.
  const video: ProbeVideoStream | null =
    rawVideo?.width !== undefined && rawVideo.height !== undefined
      ? {
          index: rawVideo.index,
          codec: rawVideo.codec_name ?? 'unknown',
          width: rawVideo.width,
          height: rawVideo.height,
          fps: parseFrameRate(rawVideo.r_frame_rate),
          pixelFormat: rawVideo.pix_fmt ?? null,
        }
      : null;

  const audio: ProbeAudioStream | null = rawAudio
    ? {
        index: rawAudio.index,
        codec: rawAudio.codec_name ?? 'unknown',
        channels: rawAudio.channels ?? 0,
        sampleRate: toNumber(rawAudio.sample_rate),
      }
    : null;

  const durationSec = toNumber(format.duration);
  if (durationSec === null || durationSec <= 0) {
    throw new ProbeFailed('ffprobe could not determine a duration', stderr);
  }

  return {
    path: filePath,
    displayName,
    container: format.format_name ?? path.extname(displayName).replace('.', ''),
    durationSec,
    sizeBytes: toNumber(format.size) ?? 0,
    bitrate: toNumber(format.bit_rate),
    video,
    audio,
  };
}

function run(
  binary: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Argument array, no shell. Same rule as every other spawn in Scrub.
    const child = spawn(binary, [...args], { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}
