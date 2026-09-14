import type { Operation } from '@scrub/shared';
import { useCallback, useEffect, useRef } from 'react';

import { ApiError, cancelRun, type RunTarget, startRun, subscribeToJob } from '@/lib/api';
import { useScrubStore } from '@/store/use-scrub-store';

/** Starts an operation and keeps the store in step with its progress stream. */
export function useRun(op: Operation | null): {
  readonly start: (editedArgv: readonly string[] | null) => void;
  readonly cancel: () => void;
} {
  const uploadId = useScrubStore((state) => state.uploadId);
  const run = useScrubStore((state) => state.run);
  const setRun = useScrubStore((state) => state.setRun);

  // Holds the detach function so a job is never left streaming into a component
  // that has gone away.
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      detachRef.current?.();
    },
    [],
  );

  const start = useCallback(
    (editedArgv: readonly string[] | null) => {
      if (!uploadId) return;
      // An edited command runs as typed; otherwise the generated operation does.
      if (!editedArgv && !op) return;

      setRun({
        status: 'running',
        jobId: '',
        progress: 0,
        // Nothing has been reported yet, so there is no fraction to believe.
        determinate: false,
        passLabel: '',
        passIndex: 0,
        passCount: 1,
        elapsedMs: 0,
      });

      const target: RunTarget | null = editedArgv ? { argv: editedArgv } : op ? { op } : null;
      if (target === null) return;

      startRun(uploadId, target)
        .then((jobId) => {
          detachRef.current?.();
          detachRef.current = subscribeToJob(jobId, (event) => {
            switch (event.type) {
              case 'progress':
                setRun({
                  status: 'running',
                  jobId,
                  progress: event.progress,
                  determinate: event.determinate,
                  passLabel: event.passLabel,
                  passIndex: event.passIndex,
                  passCount: event.passCount,
                  elapsedMs: event.elapsedMs,
                });
                return;
              case 'done':
                setRun({
                  status: 'done',
                  outputId: event.outputId,
                  outputName: event.outputName,
                  sizeBytes: event.sizeBytes,
                  elapsedMs: event.elapsedMs,
                });
                return;
              case 'error':
                setRun({ status: 'failed', message: event.message, detail: event.detail });
                return;
              case 'cancelled':
                setRun({ status: 'cancelled' });
                return;
            }
          });
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) {
            setRun({ status: 'failed', message: error.message, detail: error.detail });
          } else {
            setRun({
              status: 'failed',
              message: 'Scrub could not start the operation.',
              detail: [],
            });
          }
        });
    },
    [uploadId, op, setRun],
  );

  const cancel = useCallback(() => {
    if (run.status !== 'running' || run.jobId === '') return;
    void cancelRun(run.jobId);
  }, [run]);

  return { start, cancel };
}
