import {
  buildArgs,
  InvalidOperation,
  NotImplemented,
  type Operation,
  type OperationKind,
  OVERWRITE_ARG,
  TRANSPORT_ARGS,
  type VideoCompress,
} from '@scrub/shared';
import { useMemo } from 'react';

import { SAMPLE_ARGV } from '@/lib/sample-command';
import { type OperationParams, type TrimParams, useScrubStore } from '@/store/use-scrub-store';

/** The preset strings x264 accepts, taken from the operation type itself. */
type CompressPreset = VideoCompress['preset'];

export type CommandPassView = {
  readonly argv: readonly string[];
  readonly label: string;
};

export type LiveCommand = {
  /** The pass currently being shown. */
  readonly argv: readonly string[];
  /**
   * Every pass in the plan. GIF and loudness genuinely run two commands, and
   * showing only the first would be showing half of what happens — which is the
   * one thing the command bar must never do.
   */
  readonly passes: readonly CommandPassView[];
  /** True when this is the dimmed example, not a command anything can run. */
  readonly placeholder: boolean;
  /** The operation to send to /run, or null when there is nothing runnable. */
  readonly operation: Operation | null;
  /** Set when an operation is selected but has no argv yet. */
  readonly unavailable: OperationKind | null;
};

/**
 * The command the bar shows, and the operation the Run button sends.
 *
 * Both come from here so they cannot describe different work: the argv is built
 * from exactly the `Operation` that gets posted, and the server rebuilds it from
 * that same value with the same function.
 */
export function useCommand(kind: OperationKind | null): LiveCommand {
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);
  const trim = useScrubStore((state) => state.trim);
  const params = useScrubStore((state) => state.params);

  return useMemo<LiveCommand>(() => {
    const empty = {
      argv: SAMPLE_ARGV,
      passes: [{ argv: SAMPLE_ARGV, label: 'Example' }],
      placeholder: true,
      operation: null,
    } as const;

    if (!meta || !uploadId) return { ...empty, unavailable: null };

    if (!kind) {
      // A file is loaded but no operation is chosen yet. Showing the example
      // about someone else's holiday clip here is the one moment it actively
      // misleads — the user has just uploaded and is looking for proof it
      // worked. Their own file, dimmed, says so.
      const argv = skeletonArgv(meta.path, outputPathFor(meta.path, 'convert'));
      return {
        argv,
        passes: [{ argv, label: 'Ready' }],
        placeholder: true,
        operation: null,
        unavailable: null,
      };
    }

    const op = operationFor(kind, trim, params);
    if (!op) {
      // The operation has no argv yet, but a file *is* loaded — so rather than a
      // dimmed example about someone else's file, show a real skeleton against
      // this one. It is the starting point for the editable command bar, which is
      // how anything outside the closed operation list gets done.
      const argv = skeletonArgv(meta.path, outputPathFor(meta.path, kind));
      return {
        argv,
        passes: [{ argv, label: 'Starting point' }],
        placeholder: false,
        operation: null,
        unavailable: kind,
      };
    }

    try {
      const plan = buildArgs(op, meta, {
        inputPath: meta.path,
        // The server mints the real output path; this mirrors its naming so the
        // bar shows where the file will land.
        outputPath: outputPathFor(meta.path, kind),
        workDir: meta.path.replace(/[\\/][^\\/]+$/, ''),
        /**
         * Only replace-audio takes a second input, and only once a track has
         * been chosen. Without it the preview threw and Run stayed disabled
         * even though the file was right there on screen.
         */
        ...(params.replaceAudio.audioPath === null
          ? {}
          : { secondaryInputPath: params.replaceAudio.audioPath }),
      });
      const passes = plan.passes.map((pass) => ({ argv: pass.argv, label: pass.label }));
      const [first] = passes;
      if (!first) return { ...empty, unavailable: kind };
      return { argv: first.argv, passes, placeholder: false, operation: op, unavailable: null };
    } catch (error) {
      /**
       * An operation that cannot apply to this file, or has no argv yet.
       *
       * buildArgs now refuses a resize of an audio file rather than building a
       * command ffmpeg would silently ignore, and that refusal arrives here as a
       * throw. Letting it escape would take the whole workspace down over a
       * choice the rail already shows as unavailable.
       */
      if (error instanceof NotImplemented || error instanceof InvalidOperation) {
        const argv = skeletonArgv(meta.path, outputPathFor(meta.path, kind));
        return {
          argv,
          passes: [{ argv, label: 'Starting point' }],
          placeholder: false,
          operation: null,
          unavailable: kind,
        };
      }
      throw error;
    }
  }, [meta, uploadId, kind, trim, params]);
}

/**
 * The operation the current controls describe.
 *
 * Everything reads from the store, so moving any control rewrites the command in
 * the bar immediately — and the object built here is the exact one posted to
 * /run, where the server rebuilds the argv from it with the same function.
 */
function operationFor(
  kind: OperationKind,
  trim: TrimParams,
  params: OperationParams,
): Operation | null {
  switch (kind) {
    case 'trim':
      return { kind, startSec: trim.startSec, endSec: trim.endSec, mode: trim.mode };
    case 'compress':
      return { kind, crf: params.compress.crf, preset: params.compress.preset as CompressPreset };
    case 'convert':
      return { kind, container: params.convert.container };
    case 'resize':
      return { kind, width: params.resize.width };
    case 'gif':
      return {
        kind,
        fps: params.gif.fps,
        width: params.gif.width,
        startSec: params.gif.useRange ? trim.startSec : null,
        endSec: params.gif.useRange ? trim.endSec : null,
      };
    case 'extract-audio':
      return { kind, format: params.extractAudio.format };
    case 'mute':
      return { kind };
    case 'replace-audio':
      // Nothing to run until the replacement track has been chosen.
      return params.replaceAudio.audioId === null
        ? null
        : { kind, audioId: params.replaceAudio.audioId };
    case 'audio-convert':
      return {
        kind,
        format: params.audioConvert.format,
        bitrateKbps: params.audioConvert.bitrateKbps,
      };
    case 'audio-trim':
      return { kind, startSec: trim.startSec, endSec: trim.endSec };
    case 'loudness':
      return {
        kind,
        targetI: params.loudness.targetI,
        targetTP: params.loudness.targetTP,
        targetLRA: params.loudness.targetLRA,
      };
  }
}

/**
 * A minimal but genuinely runnable command: copy the file. It does nothing
 * interesting on its own, which is the point — it is a correct starting line for
 * an operation Scrub does not generate yet, with the real paths already in place.
 */
function skeletonArgv(inputPath: string, outputPath: string): readonly string[] {
  return [...TRANSPORT_ARGS, '-i', inputPath, '-c', 'copy', OVERWRITE_ARG, outputPath];
}

function outputPathFor(inputPath: string, kind: OperationKind): string {
  const dot = inputPath.lastIndexOf('.');
  const stem = dot > 0 ? inputPath.slice(0, dot) : inputPath;
  const ext = dot > 0 ? inputPath.slice(dot) : '';
  return `${stem}-${kind}${ext}`;
}
