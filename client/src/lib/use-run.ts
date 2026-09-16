import { operationDescriptor, type Operation } from '@scrub/shared';
import { useCallback, useEffect, useRef } from 'react';

import { ApiError, cancelRun, type RunTarget, startRun, subscribeToJob } from '@/lib/api';
import { type Measurement, useScrubStore } from '@/store/use-scrub-store';

/** Starts an operation and keeps the store in step with its progress stream. */
export function useRun(op: Operation | null): {
  readonly start: (editedArgv: readonly string[] | null) => void;
  readonly cancel: () => void;
} {
  const uploadId = useScrubStore((state) => state.uploadId);
  const meta = useScrubStore((state) => state.meta);
  const run = useScrubStore((state) => state.run);
  const setRun = useScrubStore((state) => state.setRun);
  const addJob = useScrubStore((state) => state.addJob);
  const updateJob = useScrubStore((state) => state.updateJob);

  /**
   * One detach function per job, not one in total.
   *
   * This used to hold a single subscription and tear down the previous one each
   * time Run was pressed. With a queue that is exactly wrong: starting a second
   * encode would stop listening to the first, so it would finish silently and
   * never leave the queue.
   */
  const detachRef = useRef(new Map<string, () => void>());

  /**
   * Cancel pressed before the job id came back.
   *
   * The progress bar, and the Cancel button in it, appear the moment Run is
   * pressed - before the POST that starts the job has answered with its id. In
   * that window Cancel had nothing to address and did nothing at all: no
   * cancellation, no message, and the encode ran to completion. The window is
   * short, and it is exactly when somebody who did not mean to press Run reaches
   * for Cancel. So the intent is remembered and acted on as soon as there is an
   * id to act on.
   */
  const cancelPendingRef = useRef(false);

  useEffect(() => {
    const open = detachRef.current;
    return () => {
      for (const detach of open.values()) detach();
      open.clear();
    };
  }, []);

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
        etaMs: null,
        passLabel: '',
        passIndex: 0,
        passCount: 1,
        elapsedMs: 0,
        measurement: null,
      });

      const target: RunTarget | null = editedArgv ? { argv: editedArgv } : op ? { op } : null;
      if (target === null) return;

      cancelPendingRef.current = false;

      /**
       * The measurement arrives between the two passes and has to outlive them
       * both. Reading it back off the store inside the handler would mean
       * reading whatever the last progress tick wrote, so it is held here.
       */
      let measurement: Measurement | null = null;

      startRun(uploadId, target)
        .then((jobId) => {
          // Asked to stop while this request was in flight.
          if (cancelPendingRef.current) {
            cancelPendingRef.current = false;
            void cancelRun(jobId);
          }
          /**
           * Record the id the moment it is known.
           *
           * It used to reach the store only when the first progress event
           * arrived, which on a slow first frame is hundreds of milliseconds
           * later. For that whole stretch the bar was on screen with a Cancel
           * button that had nothing to address, so pressing it did nothing at
           * all and the encode ran to completion.
           */
          setRun({
            status: 'running',
            jobId,
            progress: 0,
            determinate: false,
            etaMs: null,
            passLabel: '',
            passIndex: 0,
            passCount: 1,
            elapsedMs: 0,
            measurement: null,
          });
          addJob({
            jobId,
            kind: op?.kind ?? null,
            title: `${op ? operationDescriptor(op.kind).label : 'Edited command'} · ${meta?.displayName ?? 'file'}`,
            status: 'running',
            position: 0,
            progress: 0,
            determinate: false,
            etaMs: null,
            passLabel: '',
            elapsedMs: 0,
            outputId: null,
            outputName: null,
            sizeBytes: null,
            message: null,
          });

          const detach = subscribeToJob(jobId, (event) => {
            switch (event.type) {
              case 'progress':
                setRun({
                  status: 'running',
                  jobId,
                  progress: event.progress,
                  determinate: event.determinate,
                  etaMs: event.etaMs,
                  passLabel: event.passLabel,
                  passIndex: event.passIndex,
                  passCount: event.passCount,
                  elapsedMs: event.elapsedMs,
                  measurement,
                });
                updateJob(jobId, {
                  status: 'running',
                  position: 0,
                  progress: event.progress,
                  determinate: event.determinate,
                  etaMs: event.etaMs,
                  passLabel: event.passLabel,
                  elapsedMs: event.elapsedMs,
                });
                return;
              case 'queued':
                updateJob(jobId, { status: 'queued', position: event.position });
                return;
              case 'measured':
                measurement = {
                  inputI: event.inputI,
                  inputTP: event.inputTP,
                  inputLRA: event.inputLRA,
                };
                return;
              case 'done':
                setRun({
                  status: 'done',
                  outputId: event.outputId,
                  outputName: event.outputName,
                  sizeBytes: event.sizeBytes,
                  elapsedMs: event.elapsedMs,
                  measurement,
                });
                updateJob(jobId, {
                  status: 'done',
                  progress: 1,
                  determinate: true,
                  etaMs: null,
                  outputId: event.outputId,
                  outputName: event.outputName,
                  sizeBytes: event.sizeBytes,
                  elapsedMs: event.elapsedMs,
                });
                return;
              case 'error':
                setRun({ status: 'failed', message: event.message, detail: event.detail });
                updateJob(jobId, { status: 'failed', message: event.message });
                return;
              case 'cancelled':
                setRun({ status: 'cancelled' });
                updateJob(jobId, { status: 'cancelled' });
                return;
            }
          });
          detachRef.current.set(jobId, detach);
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
    if (run.status !== 'running') return;
    if (run.jobId === '') {
      // No id yet. Remember it and cancel the moment there is one.
      cancelPendingRef.current = true;
      return;
    }
    void cancelRun(run.jobId);
  }, [run]);

  return { start, cancel };
}
