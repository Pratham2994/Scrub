import {
  availabilityOf,
  isOperationKind,
  type OperationKind,
  operationDescriptor,
} from '@scrub/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';

import { FileStatus } from '@/components/FileStatus';
import { Handoff } from '@/components/Handoff';
import { MediaWell } from '@/components/MediaWell';
import { OperationControls } from '@/components/OperationControls';
import { ResultWell } from '@/components/ResultWell';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * Centre panel for `/op/:name`. The well holds its size so the layout does not
 * jump when the operation changes, which is the behaviour the controls below it
 * will depend on.
 */
export function OperationPanel() {
  const { name } = useParams();
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);
  const run = useScrubStore((state) => state.run);
  const setActiveOperation = useScrubStore((state) => state.setActiveOperation);
  const setRun = useScrubStore((state) => state.setRun);

  const kind = name !== undefined && isOperationKind(name) ? name : null;

  // The route is the source of truth for which operation is selected; the store
  // mirrors it so the command bar - which lives outside the route - can follow.
  useEffect(() => {
    setActiveOperation(kind);
  }, [kind, setActiveOperation]);

  if (kind === null) return <Navigate to="/" replace />;

  const descriptor = operationDescriptor(kind);
  const hasFile = meta !== null && uploadId !== null;
  // Whether this operation makes sense for the file that is actually loaded.
  const status = meta === null ? null : availabilityOf(kind, meta);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* The title stays put through the handoff. It names the operation, which
          is true before a file lands and after, so moving it would be motion
          that means nothing. */}
      <div>
        <h1 className="text-heading text-ink">{descriptor.label}</h1>
        <p className="text-micro text-muted mt-0.5">{descriptor.blurb}</p>
      </div>

      <Handoff mode={hasFile ? 'loaded' : 'empty'}>
        {hasFile && run.status === 'done' ? (
          /**
           * The run finished, so the well shows what was made rather than what it
           * was made from. Ending at a download chip left the only way to check
           * the result as opening it somewhere else.
           */
          <ResultWell
            sourceId={uploadId}
            outputId={run.outputId}
            outputName={run.outputName}
            sizeBytes={run.sizeBytes}
            elapsedMs={run.elapsedMs}
            sourceBytes={meta.sizeBytes}
            sourceIsAudio={meta.video === null}
            onDismiss={() => {
              setRun({ status: 'idle' });
            }}
          />
        ) : hasFile ? (
          <MediaWell id={uploadId} meta={meta} />
        ) : (
          // Landing here from a bookmark or a reload with nothing loaded used to be
          // a dead end that just said "No file loaded". The way forward has to be
          // on the screen the user actually arrived at - and at the same size as on
          // the home page, because it is the same invitation.
          <FileStatus
            headline={`Drop a file to ${descriptor.label.toLowerCase()}`}
            hint="Nothing is loaded yet. Drop a video or audio file here, or choose one. Trim, compress, convert, resize, GIF, extract or replace audio, or normalise loudness."
          />
        )}

        {hasFile && status?.state === 'unavailable' ? (
          <Unavailable reason={status.reason} instead={status.instead} />
        ) : (
          hasFile && <OperationControls kind={kind} id={uploadId} meta={meta} />
        )}
      </Handoff>

      <div className="border-line bg-surface rounded-control border p-4">
        {run.status === 'failed' ? (
          <div>
            <p className="text-label text-ink">{run.message}</p>
            {run.detail.length > 0 && (
              <pre className="text-mono text-muted mt-2 overflow-x-auto">
                {run.detail.join('\n')}
              </pre>
            )}
          </div>
        ) : run.status === 'cancelled' ? (
          <p className="text-label text-muted">Cancelled. Nothing was written.</p>
        ) : run.status === 'done' ? (
          <p className="text-label text-muted">
            Compare the result with the original above, then save it or adjust and run again.
          </p>
        ) : (
          <p className="text-label text-muted">
            {status?.state === 'unavailable'
              ? 'The command bar below still works if you want to write something by hand.'
              : 'Set it up above, then Run. The command bar always shows exactly what will execute, and you can edit it directly if you need something Scrub does not offer.'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The operation cannot apply to this file.
 *
 * Saying so here, rather than letting the command be built, is the whole point:
 * ffmpeg ignores a scale filter on a file with no video and reports success, so
 * a resize of an mp3 used to hand back an untouched copy and call it done.
 *
 * Where there is an operation that does what the user probably meant, it is one
 * click away. Being told "no" is much less useful than being told "not this one,
 * that one".
 */
function Unavailable({
  reason,
  instead,
}: {
  readonly reason: string;
  readonly instead: OperationKind | null;
}) {
  return (
    <div className="border-line bg-surface rounded-control border p-4">
      <p className="text-body text-ink">{reason}</p>
      {instead !== null && (
        <Link
          to={`/op/${instead}`}
          className="text-label text-ink border-line-strong hover:border-accent hover:text-accent mt-3 inline-flex items-center gap-1.5 rounded-button border px-3 py-2 transition-colors duration-100"
        >
          Use {operationDescriptor(instead).label.toLowerCase()} instead
          <ArrowRight aria-hidden size={13} />
        </Link>
      )}
    </div>
  );
}
