import { useEffect } from 'react';

import { fetchJobs, type JobSnapshot, subscribeToJob } from '@/lib/api';
import { type QueuedJob, useScrubStore } from '@/store/use-scrub-store';

/**
 * Puts the queue back after a reload.
 *
 * Jobs run in the server process and keep going whatever the browser does, so a
 * refresh in the middle of an encode used to lose sight of work that was still
 * happening: the output appeared in the working folder some minutes later with
 * nothing having said so, and the only way to notice was to go looking.
 *
 * Everything needed is already on the server - each job knows what it is and
 * keeps its last event - so this is a read and a re-subscription rather than
 * any new bookkeeping.
 */
export function useRestoreJobs(): void {
  const addJob = useScrubStore((state) => state.addJob);
  const updateJob = useScrubStore((state) => state.updateJob);

  useEffect(() => {
    /**
     * No "run once" guard here, deliberately.
     *
     * The obvious one - a ref set on the first run - is wrong under React's
     * development double-invoke: the first pass sets the flag and is then torn
     * down, and the second returns early, so the queue stayed empty in dev and
     * worked in a build. Re-fetching is a GET and costs nothing; the `cancelled`
     * flag keeps the discarded pass from writing anything.
     */
    let cancelled = false;
    const detachers: (() => void)[] = [];

    void fetchJobs()
      .then((snapshots) => {
        if (cancelled) return;
        for (const snapshot of snapshots) {
          addJob(fromSnapshot(snapshot));

          // A job still going gets its stream back, so it finishes on screen
          // rather than staying at whatever progress the reload caught it at.
          if (snapshot.status !== 'running') continue;
          detachers.push(
            subscribeToJob(snapshot.jobId, (event) => {
              switch (event.type) {
                case 'queued':
                  updateJob(snapshot.jobId, { status: 'queued', position: event.position });
                  return;
                case 'progress':
                  updateJob(snapshot.jobId, {
                    status: 'running',
                    position: 0,
                    progress: event.progress,
                    determinate: event.determinate,
                    etaMs: event.etaMs,
                    passLabel: event.passLabel,
                    elapsedMs: event.elapsedMs,
                  });
                  return;
                case 'done':
                  updateJob(snapshot.jobId, {
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
                  updateJob(snapshot.jobId, { status: 'failed', message: event.message });
                  return;
                case 'cancelled':
                  updateJob(snapshot.jobId, { status: 'cancelled' });
                  return;
                case 'measured':
                  return;
              }
            }),
          );
        }
      })
      .catch(() => {
        // The server being unreachable is the shell's problem to report, and it
        // already does. An empty queue is the right thing to show meanwhile.
      });

    return () => {
      cancelled = true;
      for (const detach of detachers) detach();
    };
  }, [addJob, updateJob]);
}

/** A server snapshot, flattened into the shape the queue strip renders. */
function fromSnapshot(snapshot: JobSnapshot): QueuedJob {
  const last = snapshot.last;
  const base: QueuedJob = {
    jobId: snapshot.jobId,
    // The server stores the slug as a plain string; the store wants the union.
    kind: (snapshot.kind ?? null) as QueuedJob['kind'],
    title: snapshot.title,
    status: snapshot.status === 'failed' ? 'failed' : snapshot.status,
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
  };

  if (last === null) return base;
  switch (last.type) {
    case 'queued':
      return { ...base, status: 'queued', position: last.position };
    case 'progress':
      return {
        ...base,
        progress: last.progress,
        determinate: last.determinate,
        etaMs: last.etaMs,
        passLabel: last.passLabel,
        elapsedMs: last.elapsedMs,
      };
    case 'done':
      return {
        ...base,
        status: 'done',
        progress: 1,
        determinate: true,
        outputId: last.outputId,
        outputName: last.outputName,
        sizeBytes: last.sizeBytes,
        elapsedMs: last.elapsedMs,
      };
    case 'error':
      return { ...base, status: 'failed', message: last.message };
    case 'cancelled':
      return { ...base, status: 'cancelled' };
    case 'measured':
      return base;
  }
}
