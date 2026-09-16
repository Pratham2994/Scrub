import { OVERWRITE_ARG, TRANSPORT_ARGS } from '@scrub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, startRun, subscribeToJob } from '@/lib/api';
import { currentTime } from '@/lib/playback';
import { useScrubStore } from '@/store/use-scrub-store';

/** "1m04.5" - the frame's moment, filename-safe. */
function stamp(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded < 60) return `${String(rounded)}s`;
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes)}m${String(Math.round((rounded - minutes * 60) * 10) / 10)}s`;
}

/**
 * Save the frame under the playhead as a lossless PNG, through the queue.
 *
 * This is a hand-built argv rather than an operation: it is one button, and the
 * closed operation list does not grow for a button. It rides the edited-command
 * path of POST /run, so it shows up in the queue and downloads like any result,
 * and it deliberately does not touch the foreground run state: grabbing a frame
 * must not disturb the operation being set up.
 */
export function useSaveFrame(): { readonly saving: boolean; readonly save: () => void } {
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);
  const addJob = useScrubStore((state) => state.addJob);
  const updateJob = useScrubStore((state) => state.updateJob);
  const [saving, setSaving] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);

  // Same lifecycle as use-run: the subscription dies with the component.
  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  const save = useCallback(() => {
    if (!meta || !uploadId || meta.video === null || saving) return;
    setSaving(true);

    const stem = meta.path.replace(/\.\w+$/, '');
    const outputPath = `${stem}-frame-${stamp(currentTime())}.png`;
    // The same prefix every operation carries, so progress reaches the bar.
    const argv = [
      ...TRANSPORT_ARGS,
      '-ss',
      String(currentTime()),
      '-i',
      meta.path,
      '-frames:v',
      '1',
      OVERWRITE_ARG,
      outputPath,
    ];

    startRun(uploadId, { argv })
      .then((jobId) => {
        addJob({
          jobId,
          kind: null,
          title: `Frame · ${meta.displayName}`,
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
        detachRef.current = subscribeToJob(jobId, (event) => {
          // Mirror use-run.ts exactly, minus the foreground setRun: the frame
          // lives in the queue only, and must not disturb the operation being
          // set up.
          if (event.type === 'progress') {
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
          }
          if (event.type === 'done') {
            updateJob(jobId, {
              status: 'done',
              progress: 1,
              determinate: true,
              outputId: event.outputId,
              outputName: event.outputName,
              sizeBytes: event.sizeBytes,
              elapsedMs: event.elapsedMs,
            });
            setSaving(false);
            return;
          }
          if (event.type === 'error' || event.type === 'cancelled') setSaving(false);
        });
      })
      .catch((error: unknown) => {
        setSaving(false);
        // Nothing to surface: a frame grab is a side action, not the operation
        // on screen, and the queue chip stays honest about the job.
        if (!(error instanceof ApiError)) return;
      });
  }, [meta, uploadId, saving, addJob, updateJob]);

  return { saving, save };
}
