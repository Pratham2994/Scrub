/**
 * The argv for every operation other than trim.
 *
 * Split out of build-args.ts purely for size - `buildArgs` is still the only
 * entry point, and everything here is the same kind of pure function it is.
 * Each one implements its entry in docs/OPERATIONS.md; the reasoning for the
 * flags lives next to the flags.
 */

import type { CommandIo, CommandPlan } from './build-args.js';
import { OVERWRITE_ARG, TRANSPORT_ARGS } from './build-args.js';
import { InvalidOperation } from './errors.js';
import type {
  AudioFade,
  AudioFormat,
  AudioLoop,
  AudioMerge,
  AudioVolume,
  VideoAddMusic,
  VideoContainer,
  VideoCrop,
  VideoFade,
  VideoGif,
  VideoLoop,
  VideoMerge,
  VideoTargetSize,
  VideoVolume,
  VideoWatermark,
  WatermarkPosition,
} from './operations.js';
import type { ProbeResult } from './probe.js';
import { maxDurationSec, videoBitrateKbps } from './size-presets.js';
import { formatSeconds } from './time.js';

/**
 * Values pass two needs that only pass one can produce.
 *
 * They appear in the argv as `@measured_I@` and so on, and the server swaps them
 * for real numbers once it has parsed pass one's JSON. Marking them rather than
 * omitting them keeps the command bar honest: it shows that pass two takes five
 * measurements from pass one, instead of quietly showing a command that is not
 * the one which runs.
 */
export const LOUDNORM_MEASURED = [
  'measured_I',
  'measured_TP',
  'measured_LRA',
  'measured_thresh',
  'offset',
] as const;

/** `@measured_I@` - deliberately not valid ffmpeg, so an unsubstituted one fails loudly. */
export function measuredPlaceholder(key: string): string {
  return `@${key}@`;
}

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
 * `-preset` trades encode time against file size *at the same quality* - it is
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
 * mp4 to webm is never a copy - different container, different codec families.
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
 * Audio is copied - nothing about a resize touches it.
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
 * looks visibly worse - it is what every bad wrapper does.
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
 * Extract audio. `-vn` removes the video stream - including cover art, which
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
 * other file - you get the original audio back, and no error to explain why.
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
 * Loudness, in two passes - the only operation where a pass needs data from the
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
  // ffmpeg re-encodes the video stream to change the sound - minutes of work and
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
          [
            `loudnorm=${targets}`,
            ...LOUDNORM_MEASURED.map((key) => `${key}=${measuredPlaceholder(key)}`),
            // With the measurements in hand the correction is a single linear
            // gain. Without them this filter is a compressor working blind, and
            // it pumps audibly - which is the whole reason for two passes.
            'linear=true',
          ].join(':'),
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

/**
 * Hit a size, in two passes.
 *
 * The bitrate is arithmetic: the target divided by the duration, less whatever
 * the audio takes. One pass at that bitrate would spend it evenly and waste it
 * on the still parts; two passes let the encoder look at the whole file first
 * and then put the bits where the picture moves. That is the difference between
 * a 10 MB file that looks watchable and one that does not.
 *
 * `-maxrate` and `-bufsize` cap the peak so a busy few seconds cannot blow the
 * budget and push the file over the limit it exists to stay under.
 *
 * Pass one writes nothing, but still has to be told the same video settings:
 * it is measuring how this encode behaves and not some other one.
 */
export function buildTargetSize(
  op: VideoTargetSize,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  if (meta.video === null) {
    throw new InvalidOperation('target-size', 'this file has no picture to fit into a size');
  }
  const bitrate = videoBitrateKbps(op.targetMiB, meta.durationSec, op.audioKbps);
  if (bitrate === null) {
    const longest = maxDurationSec(op.targetMiB, op.audioKbps);
    throw new InvalidOperation(
      'target-size',
      `${String(op.targetMiB)} MB cannot hold ${formatSeconds(meta.durationSec)} of video. About ${formatSeconds(longest)} is the most that fits. Trim it first, or pick a larger target.`,
    );
  }

  /**
   * The log ffmpeg writes in pass one and reads in pass two. It goes in the
   * working directory, and the name is fixed so a second run overwrites it
   * rather than leaving a trail of them.
   */
  const logPrefix = `${io.workDir}/scrub-2pass`;

  const scale = op.maxWidth === null ? [] : ['-vf', `scale=min(${String(op.maxWidth)}\\,iw):-2`];

  const shared = [
    '-c:v',
    'libx264',
    '-b:v',
    `${String(bitrate)}k`,
    // A peak ceiling, and a buffer worth two seconds at it.
    '-maxrate',
    `${String(Math.round(bitrate * 1.5))}k`,
    '-bufsize',
    `${String(bitrate * 2)}k`,
    ...scale,
    '-passlogfile',
    logPrefix,
  ];

  return {
    passes: [
      {
        label: 'Analyse',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          ...shared,
          '-pass',
          '1',
          // No audio and no output: this pass exists only to write the log.
          '-an',
          '-f',
          'null',
          '-',
        ],
      },
      {
        label: 'Encode',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          ...shared,
          '-pass',
          '2',
          ...(meta.audio === null ? ['-an'] : ['-c:a', 'aac', '-b:a', `${String(op.audioKbps)}k`]),
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * `atempo` clamps to 0.5..2.0 per instance, so a bigger change is several of
 * them multiplied together: 4x is `atempo=2.0,atempo=2.0`.
 *
 * Exported for the tests, which check the chain multiplies back to the factor
 * that was asked for. Getting that wrong desynchronises the sound from the
 * picture, which is the one failure this operation must not have.
 */
export function atempoChain(factor: number): string {
  const steps: number[] = [];
  let remaining = factor;
  while (remaining > 2) {
    steps.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push(0.5);
    remaining /= 0.5;
  }
  steps.push(Math.round(remaining * 1000) / 1000);
  return steps.map((step) => `atempo=${String(step)}`).join(',');
}

/**
 * Faster or slower, with the sound kept in step.
 *
 * `setpts` restamps the frames; dividing the timestamps by two makes the video
 * play twice as fast. The audio needs `atempo`, a different filter with a
 * different unit, and the two have to agree exactly or the result drifts apart
 * as it plays. They are one control here for that reason.
 *
 * `atempo` changes tempo without changing pitch, so speech stays speech rather
 * than becoming a chipmunk.
 */
export function buildSpeed(factor: number, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (!Number.isFinite(factor) || factor < 0.25 || factor > 4) {
    throw new InvalidOperation('speed', `speed must be between 0.25 and 4, got ${String(factor)}`);
  }
  if (meta.video === null) {
    throw new InvalidOperation('speed', 'this file has no picture');
  }

  const audio =
    meta.audio === null ? ['-an'] : ['-af', atempoChain(factor), '-c:a', 'aac', '-b:a', '128k'];

  return {
    passes: [
      {
        label: 'Speed',
        /**
         * The output is shorter or longer than the source, and progress divides
         * against the output. Using the source duration here would make the bar
         * finish at half way, or run past the end and sit at 100%.
         */
        outputDurationSec: meta.durationSec / factor,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vf',
          `setpts=PTS/${String(factor)}`,
          ...audio,
          '-c:v',
          'libx264',
          '-crf',
          '20',
          '-preset',
          'medium',
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/**
 * A rectangle out of the picture.
 *
 * Every number is forced even, for the same reason `-2` exists in resize:
 * libx264 needs even dimensions, and an odd *offset* puts the chroma plane half
 * a pixel out, which shows up as a colour fringe along the edges rather than as
 * an error anyone would notice.
 *
 * The rectangle is clamped to the frame. ffmpeg fails outright on a crop that
 * runs off the edge, and a filter graph error is a worse way to find out you
 * dragged too far than simply not being able to.
 */
export function buildCrop(op: VideoCrop, meta: ProbeResult, io: CommandIo): CommandPlan {
  const source = meta.video;
  if (source === null) {
    throw new InvalidOperation('crop', 'this file has no picture to crop');
  }

  const even = (value: number): number => Math.floor(value / 2) * 2;
  const x = Math.max(0, even(op.x));
  const y = Math.max(0, even(op.y));
  const width = Math.min(even(op.width), even(source.width - x));
  const height = Math.min(even(op.height), even(source.height - y));

  if (width < 16 || height < 16) {
    throw new InvalidOperation('crop', 'the selection is too small to encode');
  }

  return {
    passes: [
      {
        label: 'Crop',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vf',
          `crop=${String(width)}:${String(height)}:${String(x)}:${String(y)}`,
          '-c:v',
          'libx264',
          '-crf',
          '20',
          '-preset',
          'medium',
          // A crop does not touch the sound, so it is copied rather than
          // re-encoded for nothing.
          ...(meta.audio === null ? [] : ['-c:a', 'copy']),
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

/* ─── The merge suite ───────────────────────────────────────────────────── */

/** The extras an operation was given, or a refusal it cannot run without them. */
export function secondaryMetas(
  io: CommandIo,
  operation: string,
): readonly { readonly path: string; readonly meta: ProbeResult }[] {
  if (io.secondaryInputs === undefined) {
    throw new InvalidOperation(operation, 'the extra files were not provided');
  }
  return io.secondaryInputs;
}

/** The container an output path implies, from its extension. */
export function containerFromPath(outputPath: string): VideoContainer | null {
  const ext = outputPath.toLowerCase().match(/\.(\w+)$/)?.[1];
  if (ext === 'mp4') return 'mp4';
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv') return 'mkv';
  if (ext === 'mov') return 'mov';
  return null;
}

/**
 * xfade's offset rule: each overlap starts where the previous clip ends, minus
 * this overlap. Accumulated, not per-pair, which is the trap: the second
 * junction counts both earlier clips.
 *
 * acrossfade has no offset option at all (its `o` is a boolean `overlap`,
 * default true). With overlap on it natively trims the tail of one stream and
 * the head of the next, so the audio chain needs no arithmetic.
 */
function crossfadeOffsets(durations: readonly number[], fade: number): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    offsets.push(cursor + (durations[i] ?? 0) - fade);
    cursor = offsets[offsets.length - 1] ?? 0;
  }
  return offsets;
}

/** The joined length: everything added up, minus one fade per junction. */
function joinedDuration(durations: readonly number[], fade: number): number {
  return durations.reduce((sum, value) => sum + value, 0) - fade * (durations.length - 1);
}

export function buildMerge(op: VideoMerge, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'merge');
  const clips = [meta, ...extras.map((extra) => extra.meta)];
  if (clips.some((clip) => clip.video === null)) {
    throw new InvalidOperation('merge', 'every clip must have a picture');
  }
  const first = clips[0]?.video;
  if (!first) throw new InvalidOperation('merge', 'the first clip has no picture');
  if (clips.length < 2) throw new InvalidOperation('merge', 'merge needs at least two clips');

  // xfade demands identical geometry and constant frame rate, so everything is
  // normalized to the first clip. Even numbers: libx264 refuses odd ones.
  const w = first.width - (first.width % 2);
  const h = first.height - (first.height % 2);
  const fps = first.fps ?? 30;
  const fade = op.crossfadeSec;
  const rate = clips[0]?.audio?.sampleRate ?? 48_000;
  const durations = clips.map((clip) => clip.durationSec);
  const offsets = crossfadeOffsets(durations, fade);
  const total = joinedDuration(durations, fade);

  const paths = [io.inputPath, ...extras.map((extra) => extra.path)];
  const video: string[] = [];
  const audio: string[] = [];
  let lastVideo = '[v0]';
  let lastAudio = '[a0]';

  clips.forEach((clip, i) => {
    if (i === 0) {
      video.push(`[0:v]scale=${String(w)}:${String(h)},setsar=1,fps=${String(fps)}[v0]`);
      // A clip with no audio gets silence of exactly its length, so the chain
      // stays continuous and the picture never loses its place.
      audio.push(
        clip.audio === null
          ? `anullsrc=r=${String(rate)}:d=${String(durations[0])}[a0]`
          : `[0:a]aresample=${String(rate)}[a0]`,
      );
      return;
    }
    const offset = offsets[i - 1] ?? 0;
    video.push(
      `[${String(i)}:v]scale=${String(w)}:${String(h)},setsar=1,fps=${String(fps)}[v${String(i)}]`,
    );
    video.push(
      `[v${String(i - 1)}][v${String(i)}]xfade=transition=fade:duration=${String(fade)}:offset=${String(offset)}[xv${String(i)}]`,
    );
    lastVideo = `[xv${String(i)}]`;
    audio.push(
      clip.audio === null
        ? `anullsrc=r=${String(rate)}:d=${String(durations[i] ?? 0)}[a${String(i)}]`
        : `[${String(i)}:a]aresample=${String(rate)}[a${String(i)}]`,
    );
    audio.push(`[a${String(i - 1)}][a${String(i)}]acrossfade=d=${String(fade)}[xa${String(i)}]`);
    lastAudio = `[xa${String(i)}]`;
  });

  if (op.fadeInSec > 0) {
    video.push(`${lastVideo}fade=t=in:st=0:d=${String(op.fadeInSec)}[vfin]`);
    audio.push(`${lastAudio}afade=t=in:st=0:d=${String(op.fadeInSec)}[afin]`);
    lastVideo = '[vfin]';
    lastAudio = '[afin]';
  }
  if (op.fadeOutSec > 0) {
    video.push(
      `${lastVideo}fade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[vout]`,
    );
    audio.push(
      `${lastAudio}afade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[aout]`,
    );
    lastVideo = '[vout]';
    lastAudio = '[aout]';
  }

  return {
    passes: [
      {
        label: 'Merge',
        outputDurationSec: total,
        argv: [
          ...TRANSPORT_ARGS,
          ...paths.flatMap((path) => ['-i', path]),
          '-filter_complex',
          [...video, ...audio].join(';'),
          '-map',
          lastVideo,
          '-map',
          lastAudio,
          '-c:v',
          'libx264',
          '-crf',
          String(op.crf),
          '-preset',
          'medium',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildMergeAudio(op: AudioMerge, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'merge-audio');
  const clips = [meta, ...extras.map((extra) => extra.meta)];
  if (clips.some((clip) => clip.audio === null)) {
    throw new InvalidOperation('merge-audio', 'every file must have sound to join');
  }
  if (clips.some((clip) => clip.video !== null)) {
    throw new InvalidOperation(
      'merge-audio',
      'joining songs keeps no picture; use Merge for video',
    );
  }
  if (clips.length < 2) throw new InvalidOperation('merge-audio', 'join needs at least two files');

  const rate = clips[0]?.audio?.sampleRate ?? 48_000;
  const durations = clips.map((clip) => clip.durationSec);
  const total = joinedDuration(durations, op.crossfadeSec);
  const paths = [io.inputPath, ...extras.map((extra) => extra.path)];

  const chain: string[] = [];
  let last = '[a0]';
  clips.forEach((_clip, i) => {
    if (i === 0) {
      chain.push(`[0:a]aresample=${String(rate)}[a0]`);
      return;
    }
    chain.push(`[${String(i)}:a]aresample=${String(rate)}[a${String(i)}]`);
    chain.push(
      `[a${String(i - 1)}][a${String(i)}]acrossfade=d=${String(op.crossfadeSec)}[xa${String(i)}]`,
    );
    last = `[xa${String(i)}]`;
  });
  if (op.fadeInSec > 0) {
    chain.push(`${last}afade=t=in:st=0:d=${String(op.fadeInSec)}[afin]`);
    last = '[afin]';
  }
  if (op.fadeOutSec > 0) {
    chain.push(
      `${last}afade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[aout]`,
    );
    last = '[aout]';
  }

  return {
    passes: [
      {
        label: 'Merge audio',
        outputDurationSec: total,
        argv: [
          ...TRANSPORT_ARGS,
          ...paths.flatMap((path) => ['-i', path]),
          '-filter_complex',
          chain.join(';'),
          '-map',
          last,
          '-c:a',
          'aac',
          '-b:a',
          `${String(op.bitrateKbps)}k`,
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAddMusic(op: VideoAddMusic, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'add-music');
  const music = extras[0];
  if (!music || music.meta.audio === null) {
    throw new InvalidOperation('add-music', 'the music file has no sound');
  }

  // The picture is copied bit for bit; only the mix is encoded. Without audio
  // of its own, the music alone becomes the track.
  const filter =
    meta.audio === null
      ? `[1:a]volume=${String(op.musicPercent / 100)}[aout]`
      : `[0:a]volume=${String(op.originalPercent / 100)}[a0];[1:a]volume=${String(op.musicPercent / 100)}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`;

  return {
    passes: [
      {
        label: 'Add music',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-i',
          music.path,
          '-filter_complex',
          filter,
          '-map',
          '0:v:0',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

const WATERMARK_XY: Record<WatermarkPosition, string> = {
  nw: '10:10',
  n: '(W-w)/2:10',
  ne: 'W-w-10:10',
  w: '10:(H-h)/2',
  center: '(W-w)/2:(H-h)/2',
  e: 'W-w-10:(H-h)/2',
  sw: '10:H-h-10',
  s: '(W-w)/2:H-h-10',
  se: 'W-w-10:H-h-10',
};

export function buildWatermark(op: VideoWatermark, meta: ProbeResult, io: CommandIo): CommandPlan {
  const source = meta.video;
  if (source === null) {
    throw new InvalidOperation('watermark', 'this file has no picture to stamp');
  }
  const extras = secondaryMetas(io, 'watermark');
  const image = extras[0];
  if (!image) throw new InvalidOperation('watermark', 'no image was provided');

  // The mark is capped at a quarter of the frame so it never takes over, and
  // must not be upscaled past its own size.
  const cap = Math.floor(source.width / 4);
  const filter = `[1:v]scale=min(iw\\,${String(cap)}):-2,format=rgba,colorchannelmixer=aa=${String(op.opacity / 100)}[wm];[0:v][wm]overlay=${WATERMARK_XY[op.position]}[vout]`;

  const codecs = CODEC_MAP[containerFromPath(io.outputPath) ?? 'mp4'];

  return {
    passes: [
      {
        label: 'Watermark',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-i',
          image.path,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          ...(meta.audio === null ? ['-an'] : ['-map', '0:a:0', '-c:a', 'copy']),
          '-c:v',
          codecs.video,
          '-crf',
          '20',
          '-preset',
          'medium',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildFade(op: VideoFade, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (op.fadeInSec <= 0 && op.fadeOutSec <= 0) {
    throw new InvalidOperation('fade', 'both fades are zero, so there is nothing to fade');
  }
  const video: string[] = [];
  if (op.fadeInSec > 0) video.push(`fade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0) {
    video.push(
      `fade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );
  }

  const audio: string[] = [];
  if (op.fadeInSec > 0) audio.push(`afade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0) {
    audio.push(
      `afade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );
  }

  const codecs = CODEC_MAP[containerFromPath(io.outputPath) ?? 'mp4'];

  return {
    passes: [
      {
        label: 'Fade',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vf',
          video.join(','),
          '-c:v',
          codecs.video,
          '-crf',
          '20',
          '-preset',
          'medium',
          ...(meta.audio === null
            ? ['-an']
            : ['-af', audio.join(','), '-c:a', codecs.audio, '-b:a', '192k']),
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioFade(op: AudioFade, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (meta.audio === null) {
    throw new InvalidOperation('audio-fade', 'this file has no sound to fade');
  }
  if (op.fadeInSec <= 0 && op.fadeOutSec <= 0) {
    throw new InvalidOperation('audio-fade', 'both fades are zero, so there is nothing to fade');
  }
  const chain: string[] = [];
  if (op.fadeInSec > 0) chain.push(`afade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0) {
    chain.push(
      `afade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );
  }

  return {
    passes: [
      {
        label: 'Fade audio',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          chain.join(','),
          ...(meta.video === null ? [] : ['-c:v', 'copy']),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildLoop(op: VideoLoop, meta: ProbeResult, io: CommandIo): CommandPlan {
  loopTimes(op.times, 'loop');
  return {
    passes: [
      {
        label: 'Loop',
        // Stream copy: instant, and byte-faithful. -stream_loop counts *extra*
        // plays, so "3 times" is 2 loops.
        outputDurationSec: meta.durationSec * op.times,
        argv: [
          ...TRANSPORT_ARGS,
          '-stream_loop',
          String(op.times - 1),
          '-i',
          io.inputPath,
          '-c',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioLoop(op: AudioLoop, meta: ProbeResult, io: CommandIo): CommandPlan {
  loopTimes(op.times, 'audio-loop');
  return {
    passes: [
      {
        label: 'Loop audio',
        outputDurationSec: meta.durationSec * op.times,
        argv: [
          ...TRANSPORT_ARGS,
          '-stream_loop',
          String(op.times - 1),
          '-i',
          io.inputPath,
          '-c',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

function loopTimes(times: number, operation: string): void {
  if (!Number.isInteger(times) || times < 2 || times > 16) {
    throw new InvalidOperation(operation, `loops must be between 2 and 16, got ${String(times)}`);
  }
}

export function buildVolume(op: VideoVolume, meta: ProbeResult, io: CommandIo): CommandPlan {
  gainCheck(op.gainDb, 'volume');
  return {
    passes: [
      {
        label: 'Volume',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-c:v',
          'copy',
          '-af',
          `volume=${String(op.gainDb)}dB`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioVolume(op: AudioVolume, meta: ProbeResult, io: CommandIo): CommandPlan {
  gainCheck(op.gainDb, 'audio-volume');
  return {
    passes: [
      {
        label: 'Volume',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          `volume=${String(op.gainDb)}dB`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

function gainCheck(gainDb: number, operation: string): void {
  if (!Number.isFinite(gainDb) || gainDb < -20 || gainDb > 20 || gainDb === 0) {
    throw new InvalidOperation(
      operation,
      `gain must be between -20 and 20 dB and not zero, got ${String(gainDb)}`,
    );
  }
}
