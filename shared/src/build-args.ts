import { InvalidOperation, NotImplemented } from './errors.js';
import type { Operation } from './operations.js';
import type { ProbeResult } from './probe.js';
import { formatSeconds } from './time.js';

/**
 * Tokens ffmpeg needs in order to talk to Scrub, as opposed to tokens that do the
 * user's work. They are part of `argv` — CLAUDE.md's first non-negotiable says the
 * displayed command and the executed command are the same array, and a prefix the
 * server appended behind the preview's back would break that. They are exported so
 * the command bar can render them dimmed and so "copy without them" stays a single
 * well-defined operation rather than a regex guess.
 */
export const TRANSPORT_ARGS = [
  '-hide_banner',
  '-nostdin',
  // Progress comes from stdout key=value pairs, never from parsing the stderr log.
  '-nostats',
  '-progress',
  'pipe:1',
] as const;

/** Output paths are freshly minted ids, but `-nostdin` turns a collision into a hang. */
export const OVERWRITE_ARG = '-y';

export type CommandPass = {
  /** The exact array handed to `spawn`. Nothing is added to it downstream. */
  readonly argv: readonly string[];
  /** Human label for multi-pass plans: "Generate palette", "Measure loudness". */
  readonly label: string;
  /**
   * Expected duration of *this pass's output*, in seconds, or null when the pass
   * produces no timeline (palettegen writes a single PNG).
   *
   * This is the progress denominator, and it is deliberately not the source
   * duration. With `-ss` before `-i` ffmpeg restarts output timestamps at zero, so
   * `out_time` on a 30-second trim of a 10-minute file runs 0 -> 30, not 720 -> 750.
   * Dividing by the source duration would peg that encode at 4% and leave it there.
   */
  readonly outputDurationSec: number | null;
  /**
   * Set when a later pass needs data parsed out of this one's output. Only
   * loudnorm uses it: pass 1 prints measured values as JSON on stderr and pass 2
   * feeds them back in.
   */
  readonly capture?: 'loudnorm-json';
};

export type CommandPlan = {
  readonly passes: readonly CommandPass[];
};

/**
 * Real filesystem paths. These land in `argv` verbatim, so what the command bar
 * shows is what runs — the bar shortens them to basenames for reading, but the
 * copy button and `spawn` both take this array untouched.
 */
export type CommandIo = {
  readonly inputPath: string;
  readonly outputPath: string;
  /** Scratch directory for intermediates, e.g. the GIF palette PNG. */
  readonly workDir: string;
};

/**
 * The one function that produces every ffmpeg invocation in Scrub. The command bar
 * renders its output and `spawn` consumes it; there is no second code path.
 *
 * Pure: no I/O, no clock, no randomness. That is what makes the whole surface
 * snapshot-testable, which CLAUDE.md calls the highest-value test surface here.
 */
export function buildArgs(op: Operation, meta: ProbeResult, io: CommandIo): CommandPlan {
  switch (op.kind) {
    case 'trim':
      return op.mode === 'fast'
        ? buildFastTrim(op.startSec, op.endSec, meta, io)
        : notImplemented('trim (precise)');
    case 'compress':
      return notImplemented('compress');
    case 'convert':
      return notImplemented('convert');
    case 'resize':
      return notImplemented('resize');
    case 'gif':
      return notImplemented('gif');
    case 'extract-audio':
      return notImplemented('extract-audio');
    case 'mute':
      return notImplemented('mute');
    case 'replace-audio':
      return notImplemented('replace-audio');
    case 'audio-convert':
      return notImplemented('audio-convert');
    case 'audio-trim':
      return notImplemented('audio-trim');
    case 'loudness':
      return notImplemented('loudness');
  }
}

function notImplemented(operation: string): never {
  throw new NotImplemented(operation);
}

/**
 * Fast trim: keyframe seek, no re-encode.
 *
 *   ffmpeg -ss 12.4 -i in.mp4 -t 35.7 -c copy -avoid_negative_ts make_zero -y out.mp4
 *
 * `-ss` before `-i` is an *input* option, so ffmpeg seeks the demuxer instead of
 * decoding up to the mark. That is the whole point of the fast path, and it is also
 * its cost: with `-c copy` the cut can only land on a keyframe, so the clip may
 * begin slightly earlier than asked and run slightly long. The UI has to say that
 * out loud — users read "Fast" as "less accurate", not as "possibly longer".
 *
 * `-t` rather than `-to`: `-t` is unambiguously the duration of the output, while
 * `-to` after an input-side `-ss` is the exact combination whose meaning people
 * get wrong. The user thinks in start/end; the conversion to a duration happens
 * here, once, where a test can pin it.
 *
 * `-avoid_negative_ts make_zero`: a stream copy that starts mid-stream carries the
 * source's timestamps, and the first packet can land before zero. Some players
 * render that as a frozen opening frame. Shifting to zero costs nothing.
 */
function buildFastTrim(
  startSec: number,
  endSec: number,
  meta: ProbeResult,
  io: CommandIo,
): CommandPlan {
  const start = Math.max(0, startSec);
  // A scrub handle dragged to the far right can land a hair past the probed
  // duration through float accumulation. Clamping keeps the displayed command
  // honest about where the cut actually ends.
  const end = Math.min(endSec, meta.durationSec);

  if (!(end > start)) {
    throw new InvalidOperation(
      'trim',
      `end (${String(endSec)}) must be after start (${String(startSec)})`,
    );
  }

  const duration = end - start;

  return {
    passes: [
      {
        label: 'Trim',
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
