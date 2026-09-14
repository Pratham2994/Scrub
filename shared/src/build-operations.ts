/**
 * The argv for every operation other than trim.
 *
 * Split out of build-args.ts purely for size — `buildArgs` is still the only
 * entry point, and everything here is the same kind of pure function it is.
 * Each one implements its entry in docs/OPERATIONS.md; the reasoning for the
 * flags lives next to the flags.
 */

import type { CommandIo, CommandPlan } from './build-args.js';
import { OVERWRITE_ARG, TRANSPORT_ARGS } from './build-args.js';
import { InvalidOperation } from './errors.js';
import type { AudioFormat, VideoContainer, VideoGif } from './operations.js';
import type { ProbeResult } from './probe.js';
import { formatSeconds } from './time.js';

/** Clamp a start/end pair against the real duration and turn it into a length. */
export function trimWindow(
  startSec: number,
  endSec: number,
  meta: ProbeResult,
  operation: string,
): { start: number; duration: number } {
  const start = Math.max(0, startSec);
  const end = Math.min(endSec, meta.durationSec);
  if (!(end > start)) {
    throw new InvalidOperation(
      operation,
      `end (${String(endSec)}) must be after start (${String(startSec)})`,
    );
  }
  return { start, duration: end - start };
}

/**
 * Compress: CRF, not a target bitrate.
 *
 * The user wants "smaller" and has no bitrate budget in mind. CRF asks for a
 * quality level and lets the encoder spend whatever bits that needs, which fits
 * the question actually being asked. 18 is near-lossless, 23 default, 28 soft.
 *
 * `-preset` trades encode time against file size *at the same quality* — it is
 * not a quality control, though everyone assumes it is.
 *
 * `+faststart` moves the moov atom to the front so the file starts playing
 * before it has fully downloaded, which is what a file about to be sent
 * somewhere wants. It costs a second pass over the output.
 */
export function buildCompress(
  crf: number,
  preset: string,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) {
    throw new InvalidOperation('compress', `CRF must be between 0 and 51, got ${String(crf)}`);
  }
  return {
    passes: [
      {
        label: 'Compress',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-c:v',
          'libx264',
          '-crf',
          String(crf),
          '-preset',
          preset,
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/** Container to codecs. Converting a container is not remuxing. */
const CODEC_MAP: Record<VideoContainer, { readonly video: string; readonly audio: string }> = {
  mp4: { video: 'libx264', audio: 'aac' },
  webm: { video: 'libvpx-vp9', audio: 'libopus' },
  mkv: { video: 'libx264', audio: 'aac' },
  mov: { video: 'libx264', audio: 'aac' },
};

/** Video codecs each container can hold without re-encoding. */
const CONTAINER_ACCEPTS: Record<VideoContainer, ReadonlySet<string>> = {
  mp4: new Set(['h264', 'hevc', 'mpeg4', 'av1']),
  webm: new Set(['vp8', 'vp9', 'av1']),
  // Matroska takes essentially anything, which is what makes it the one
  // container where "convert" is usually free.
  mkv: new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores']),
  mov: new Set(['h264', 'hevc', 'prores', 'mpeg4']),
};

/**
 * Convert: re-encode, unless the target container can already hold what is here.
 *
 * mp4 to webm is never a copy — different container, different codec families.
 * But h264 in mp4 to h264 in mkv is a remux, and doing that as a re-encode would
 * cost minutes and quality to change a file extension.
 */
export function buildConvert(
  container: VideoContainer,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  const sourceCodec = meta.video?.codec.toLowerCase() ?? null;
  const canCopy = sourceCodec !== null && CONTAINER_ACCEPTS[container].has(sourceCodec);
  const codecs = CODEC_MAP[container];

  const encode = ['-c:v', codecs.video, '-c:a', codecs.audio];
  if (container === 'mp4') encode.push('-movflags', '+faststart');

  return {
    passes: [
      {
        label: canCopy ? 'Remux' : 'Convert',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          ...(canCopy ? ['-c', 'copy'] : encode),
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * Resize to a target width.
 *
 * `-2`, never `-1`. Both preserve the aspect ratio, but `-1` computes the exact
 * height and can land on an odd number, which libx264 refuses with an error that
 * says nothing about the `-1`. `-2` rounds to the nearest even number.
 *
 * Audio is copied — nothing about a resize touches it.
 */
export function buildResize(width: number, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (!Number.isInteger(width) || width <= 0 || width % 2 !== 0) {
    throw new InvalidOperation(
      'resize',
      `width must be a positive even number, got ${String(width)}`,
    );
  }
  return {
    passes: [
      {
        label: 'Resize',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vf',
          `scale=${String(width)}:-2`,
          '-c:v',
          'libx264',
          '-crf',
          '20',
          '-preset',
          'medium',
          '-c:a',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * GIF, in two passes.
 *
 * Pass one derives a 256-colour palette from the actual frames; pass two maps
 * against it. A single pass falls back to a fixed 216-colour web palette and
 * looks visibly worse — it is what every bad wrapper does.
 *
 * The filter chain must be identical in both passes, or the palette is built
 * from different pixels than it is applied to. That is why it is computed once
 * here and used twice.
 */
export function buildGif(op: VideoGif, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (!Number.isInteger(op.width) || op.width <= 0 || op.width % 2 !== 0) {
    throw new InvalidOperation(
      'gif',
      `width must be a positive even number, got ${String(op.width)}`,
    );
  }

  const palettePath = joinPath(io.workDir, 'palette.png');
  const chain = `fps=${String(op.fps)},scale=${String(op.width)}:-2:flags=lanczos`;

  // A GIF of an entire clip is rarely what anyone wants, so the window is
  // optional and only appears when it was actually set.
  const window: string[] = [];
  let duration = meta.durationSec;
  if (op.startSec !== null || op.endSec !== null) {
    const windowed = trimWindow(op.startSec ?? 0, op.endSec ?? meta.durationSec, meta, 'gif');
    window.push('-ss', formatSeconds(windowed.start), '-t', formatSeconds(windowed.duration));
    duration = windowed.duration;
  }

  return {
    passes: [
      {
        label: 'Generate palette',
        // A single PNG has no timeline to measure progress against.
        outputDurationSec: null,
        argv: [
          ...TRANSPORT_ARGS,
          ...window,
          '-i',
          io.inputPath,
          '-vf',
          `${chain},palettegen`,
          OVERWRITE_ARG,
          palettePath,
        ],
      },
      {
        label: 'Apply palette',
        outputDurationSec: duration,
        argv: [
          ...TRANSPORT_ARGS,
          ...window,
          '-i',
          io.inputPath,
          '-i',
          palettePath,
          '-lavfi',
          `${chain}[x];[x][1:v]paletteuse`,
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

const AUDIO_ENCODERS: Record<AudioFormat, string> = {
  mp3: 'libmp3lame',
  aac: 'aac',
  wav: 'pcm_s16le',
  flac: 'flac',
  opus: 'libopus',
};

/** Which source codecs each target format can hold untouched. */
const AUDIO_PASSTHROUGH: Record<AudioFormat, ReadonlySet<string>> = {
  mp3: new Set(['mp3']),
  aac: new Set(['aac']),
  wav: new Set(['pcm_s16le', 'pcm_s16be']),
  flac: new Set(['flac']),
  opus: new Set(['opus']),
};

/** Bitrate is meaningless for formats that throw nothing away. */
function isLossless(format: AudioFormat): boolean {
  return format === 'wav' || format === 'flac';
}

/**
 * Copy when the track is already what was asked for. Re-encoding AAC to AAC
 * because the user picked "aac" from a menu loses quality for nothing.
 */
function audioCodecArgs(
  format: AudioFormat,
  sourceCodec: string | null,
  bitrateKbps: number | null,
): string[] {
  if (sourceCodec !== null && AUDIO_PASSTHROUGH[format].has(sourceCodec)) {
    return ['-c:a', 'copy'];
  }
  const args = ['-c:a', AUDIO_ENCODERS[format]];
  if (!isLossless(format) && bitrateKbps !== null) {
    args.push('-b:a', `${String(bitrateKbps)}k`);
  }
  return args;
}

/**
 * Extract audio. `-vn` removes the video stream — including cover art, which
 * ffmpeg also counts as video, and which is the right outcome here.
 */
export function buildExtractAudio(
  format: AudioFormat,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  if (meta.audio === null) {
    throw new InvalidOperation('extract-audio', 'this file has no audio track');
  }
  return {
    passes: [
      {
        label: 'Extract audio',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vn',
          ...audioCodecArgs(format, meta.audio.codec.toLowerCase(), null),
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * Mute: drop the audio and never touch the video.
 *
 * `-c:v copy` is the whole operation. Re-encoding a video to delete a stream
 * would cost minutes and quality for nothing.
 */
export function buildMute(meta: ProbeResult, io: CommandIo): CommandPlan {
  if (meta.audio === null) {
    throw new InvalidOperation('mute', 'this file already has no audio track');
  }
  return {
    passes: [
      {
        label: 'Mute',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-an',
          '-c:v',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * Replace audio: video from the first input, audio from the second.
 *
 * `-map` is not optional. Without it ffmpeg's default stream selection takes one
 * stream per type from whichever input it prefers and silently ignores the
 * other file — you get the original audio back, and no error to explain why.
 *
 * `-shortest` ends at whichever track runs out first. Padding the audio or
 * letting the video run silent are both decisions the user should make, so this
 * is surfaced in the UI rather than hidden in the command.
 */
export function buildReplaceAudio(meta: ProbeResult, io: CommandIo): CommandPlan {
  if (io.secondaryInputPath === undefined) {
    throw new InvalidOperation('replace-audio', 'no replacement audio file was provided');
  }
  return {
    passes: [
      {
        label: 'Replace audio',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-i',
          io.secondaryInputPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/** Audio convert: the same passthrough logic, with no video to drop. */
export function buildAudioConvert(
  format: AudioFormat,
  bitrateKbps: number | null,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  if (meta.audio === null) {
    throw new InvalidOperation('audio-convert', 'this file has no audio track');
  }
  return {
    passes: [
      {
        label: 'Convert audio',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vn',
          ...audioCodecArgs(format, meta.audio.codec.toLowerCase(), bitrateKbps),
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * Audio trim. The same argument as the video trim, minus the keyframe problem:
 * audio frames are small enough that a stream copy is near sample-accurate, so
 * there is no fast/precise decision to force on anyone.
 */
export function buildAudioTrim(
  startSec: number,
  endSec: number,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  const { start, duration } = trimWindow(startSec, endSec, meta, 'audio-trim');
  return {
    passes: [
      {
        label: 'Trim audio',
        outputDurationSec: duration,
        argv: [
          ...TRANSPORT_ARGS,
          '-ss',
          formatSeconds(start),
          '-i',
          io.inputPath,
          '-t',
          formatSeconds(duration),
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * Loudness, in two passes — the only operation where a pass needs data from the
 * one before it.
 *
 * Pass one measures and prints its findings as JSON on **stderr**; pass two
 * applies a single calculated gain. The server parses that JSON in between and
 * completes pass two's filter, which is what `capture` marks.
 *
 * Single-pass loudnorm is a dynamic normaliser working blind, and it pumps
 * audibly. The second pass is what makes it a linear correction instead.
 *
 * The `measured_*` values are deliberately absent here: they cannot exist until
 * pass one has run, and inventing placeholders would put numbers in the command
 * bar that are not the ones that will be used.
 */
export function buildLoudness(
  targetI: number,
  targetTP: number,
  targetLRA: number,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  if (meta.audio === null) {
    throw new InvalidOperation('loudness', 'this file has no audio track');
  }
  const targets = `I=${String(targetI)}:TP=${String(targetTP)}:LRA=${String(targetLRA)}`;

  // Normalising a video's audio must not re-encode its picture. Without this,
  // ffmpeg re-encodes the video stream to change the sound — minutes of work and
  // a generation of quality lost on a file the operation never meant to touch.
  const keepVideo = meta.video === null ? [] : ['-c:v', 'copy'];

  return {
    passes: [
      {
        label: 'Measure loudness',
        // Pass one decodes the whole file even though it writes nothing, so
        // progress against the source duration is meaningful.
        outputDurationSec: meta.durationSec,
        capture: 'loudnorm-json',
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          `loudnorm=${targets}:print_format=json`,
          '-f',
          'null',
          // ffmpeg's name for "write nothing". It is the output path.
          '-',
        ],
      },
      {
        label: 'Apply loudness',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          `loudnorm=${targets}:linear=true`,
          ...keepVideo,
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/** Joins without `node:path`, because this package must stay free of Node APIs. */
function joinPath(directory: string, name: string): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`;
}
