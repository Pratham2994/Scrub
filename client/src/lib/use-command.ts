import { buildArgs, NotImplemented, type Operation, type OperationKind } from '@scrub/shared';
import { useMemo } from 'react';

import { SAMPLE_ARGV } from '@/lib/sample-command';
import { useScrubStore } from '@/store/use-scrub-store';

export type LiveCommand = {
  readonly argv: readonly string[];
  /** True when this is the dimmed example, not a command anything can run. */
  readonly placeholder: boolean;
  /** Set when the chosen operation has no argv yet. */
  readonly unavailable: string | null;
};

/**
 * The command the bar shows.
 *
 * There is no second code path here: this calls the same `buildArgs` the server
 * calls before it spawns. When nothing is loaded the bar falls back to the
 * dimmed example so the tool explains itself from the first second.
 */
export function useCommand(kind: OperationKind | null): LiveCommand {
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);

  return useMemo<LiveCommand>(() => {
    if (!meta || !uploadId || !kind) {
      return { argv: SAMPLE_ARGV, placeholder: true, unavailable: null };
    }

    const op = defaultOperation(kind, meta.durationSec);
    if (!op) {
      return { argv: SAMPLE_ARGV, placeholder: true, unavailable: kind };
    }

    try {
      const plan = buildArgs(op, meta, {
        inputPath: meta.path,
        // The server mints the real output id; the bar shows where it will land.
        outputPath: outputPathFor(meta.path, kind),
        workDir: meta.path.replace(/[\\/][^\\/]+$/, ''),
      });
      const [first] = plan.passes;
      if (!first) return { argv: SAMPLE_ARGV, placeholder: true, unavailable: kind };
      return { argv: first.argv, placeholder: false, unavailable: null };
    } catch (error) {
      if (error instanceof NotImplemented) {
        return { argv: SAMPLE_ARGV, placeholder: true, unavailable: kind };
      }
      throw error;
    }
  }, [meta, uploadId, kind]);
}

/**
 * Starting parameters for each operation. These are what the controls will be
 * initialised to, so the bar shows a runnable command the moment an operation is
 * picked rather than an empty one waiting to be filled in.
 */
function defaultOperation(kind: OperationKind, durationSec: number): Operation | null {
  switch (kind) {
    case 'trim':
      return { kind: 'trim', startSec: 0, endSec: durationSec, mode: 'fast' };
    default:
      // Every other operation throws NotImplemented in buildArgs anyway; returning
      // null here keeps that one fact in one place.
      return null;
  }
}

function outputPathFor(inputPath: string, kind: OperationKind): string {
  const dot = inputPath.lastIndexOf('.');
  const stem = dot > 0 ? inputPath.slice(0, dot) : inputPath;
  const ext = dot > 0 ? inputPath.slice(dot) : '';
  return `${stem}-${kind}${ext}`;
}
