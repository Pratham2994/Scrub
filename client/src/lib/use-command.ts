import {
  buildArgs,
  NotImplemented,
  type Operation,
  type OperationKind,
  OVERWRITE_ARG,
  TRANSPORT_ARGS,
} from '@scrub/shared';
import { useMemo } from 'react';

import { SAMPLE_ARGV } from '@/lib/sample-command';
import { type TrimParams, useScrubStore } from '@/store/use-scrub-store';

export type LiveCommand = {
  readonly argv: readonly string[];
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

  return useMemo<LiveCommand>(() => {
    const empty = {
      argv: SAMPLE_ARGV,
      placeholder: true,
      operation: null,
    } as const;

    if (!meta || !uploadId || !kind) return { ...empty, unavailable: null };

    const op = operationFor(kind, trim);
    if (!op) {
      // The operation has no argv yet, but a file *is* loaded — so rather than a
      // dimmed example about someone else's file, show a real skeleton against
      // this one. It is the starting point for the editable command bar, which is
      // how anything outside the closed operation list gets done.
      return {
        argv: skeletonArgv(meta.path, outputPathFor(meta.path, kind)),
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
      });
      const [first] = plan.passes;
      if (!first) return { ...empty, unavailable: kind };
      return { argv: first.argv, placeholder: false, operation: op, unavailable: null };
    } catch (error) {
      if (error instanceof NotImplemented) return { ...empty, unavailable: kind };
      throw error;
    }
  }, [meta, uploadId, kind, trim]);
}

/**
 * The operation the current controls describe. Trim reads its real parameters
 * from the store, so moving a handle changes the command in the bar immediately.
 */
function operationFor(kind: OperationKind, trim: TrimParams): Operation | null {
  switch (kind) {
    case 'trim':
      return { kind: 'trim', startSec: trim.startSec, endSec: trim.endSec, mode: trim.mode };
    default:
      // Everything else throws NotImplemented in buildArgs anyway; returning null
      // keeps that one fact in one place.
      return null;
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
