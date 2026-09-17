import { Check, Download, X } from 'lucide-react';
import { useNavigate } from 'react-router';

import { cancelRun, downloadUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/use-theme';
import { type QueuedJob, useScrubStore } from '@/store/use-scrub-store';

/**
 * What is encoding, and what has finished.
 *
 * Without this, starting a compress meant watching a bar until it ended: moving
 * to another operation reset the foreground run state, so the encode carried on
 * invisibly and its result was reachable only by going back. The queue is what
 * makes "set the next one up while this runs" an actual workflow rather than a
 * thing that happens to work if you do not look away.
 *
 * It sits directly above the command bar, which is where the run was started
 * from, and it is not there at all when nothing has been run.
 */
export function Queue() {
  const jobs = useScrubStore((state) => state.jobs);
  const forgetFinishedJobs = useScrubStore((state) => state.forgetFinishedJobs);
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';

  if (jobs.length === 0) return null;

  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const finished = jobs.length - active;

  return (
    <div className="border-line bg-paper flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2 phosphor:font-mono">
      <span className="text-micro text-muted mr-1 shrink-0">
        {active > 0
          ? `${String(active)} ${active === 1 ? 'job' : 'jobs'} running`
          : `${String(finished)} finished`}
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {jobs.map((job) => (
          <JobChip key={job.jobId} job={job} phosphor={phosphor} />
        ))}
      </div>

      {finished > 0 && (
        <button
          type="button"
          onClick={forgetFinishedJobs}
          className="text-micro text-muted hover:text-ink shrink-0 rounded-button px-2 py-1 transition-colors duration-100"
        >
          Clear finished
        </button>
      )}
    </div>
  );
}

/** "2m" or "40s". Short enough to sit inside a chip. */
function formatShort(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.round(seconds / 60))}m`;
}

/**
 * One job. A finished one is a link to its operation, because the thing you
 * want after "done" is to look at it - and the result panel lives on the
 * operation's own route.
 */
function JobChip({ job, phosphor }: { readonly job: QueuedJob; readonly phosphor: boolean }) {
  const navigate = useNavigate();
  const percent = Math.round(job.progress * 100);

  const body = (
    <>
      <span className="truncate">{job.title}</span>
      {job.status === 'queued' && (
        <span className="text-micro text-muted shrink-0 tabular-nums">
          {job.position === 1 ? 'next' : `${String(job.position)} in line`}
        </span>
      )}
      {job.status === 'running' && (
        <span className="text-micro text-muted shrink-0 tabular-nums">
          {job.determinate ? `${String(percent)}%` : job.passLabel || 'working'}
          {/* The same figure the command bar shows, and the same reason: what a
              queued job needs to say is how much longer, not how long so far. */}
          {job.etaMs !== null && ` · ${formatShort(job.etaMs)} left`}
        </span>
      )}
      {job.status === 'done' && (
        <Check aria-hidden size={12} className="text-token-path shrink-0" />
      )}
      {job.status === 'failed' && (
        // The only status word in the strip with no weight, while `done` gets a
        // green check. A run that stopped should not be the quietest chip.
        <span className="text-micro text-destructive shrink-0 font-medium">failed</span>
      )}
      {job.status === 'cancelled' && <span className="text-micro shrink-0">cancelled</span>}
    </>
  );

  return (
    <div
      className={cn(
        'text-label relative flex max-w-xs min-w-0 items-center gap-2 overflow-hidden rounded-button border px-2.5 py-1',
        job.status === 'done' ? 'border-line-strong text-ink' : 'border-line text-muted',
        // A scrollback line has no chrome: no border, no padding, no fill.
        // The halo below is the only ornament, and only while running.
        phosphor && 'border-0 px-0 py-0',
        phosphor && job.status === 'running' && 'animate-chip-glow',
      )}
    >
      {/* The fill runs behind the label rather than beside it, so a chip is its
          own progress bar and the row does not grow a second one. */}
      {job.status === 'running' && job.determinate && (
        <div
          aria-hidden
          className="bg-accent/15 absolute inset-y-0 left-0 transition-[width] duration-150"
          style={{ width: `${String(percent)}%` }}
        />
      )}

      {job.status === 'done' && job.kind !== null ? (
        <button
          type="button"
          onClick={() => {
            void navigate(`/op/${job.kind ?? ''}`);
          }}
          title="Show this result"
          className="relative flex min-w-0 items-center gap-2"
        >
          {body}
        </button>
      ) : (
        <span className="relative flex min-w-0 items-center gap-2">{body}</span>
      )}

      {job.status === 'done' && job.outputId !== null && (
        <a
          href={downloadUrl(job.outputId)}
          download={job.outputName ?? undefined}
          title={`Save ${job.outputName ?? 'the result'}`}
          className="text-muted hover:text-accent relative shrink-0 transition-colors duration-100"
        >
          <Download aria-hidden size={12} />
        </a>
      )}

      {(job.status === 'running' || job.status === 'queued') && (
        <button
          type="button"
          aria-label={`Cancel ${job.title}`}
          title="Cancel"
          onClick={() => {
            void cancelRun(job.jobId);
          }}
          className="text-muted hover:text-ink relative shrink-0 transition-colors duration-100"
        >
          <X aria-hidden size={12} />
        </button>
      )}
    </div>
  );
}
