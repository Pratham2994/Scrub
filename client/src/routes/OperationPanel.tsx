import { isOperationKind, operationDescriptor } from '@scrub/shared';
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';

import { Dropzone } from '@/components/Dropzone';
import { MediaWell } from '@/components/MediaWell';
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
  const load = useScrubStore((state) => state.load);
  const run = useScrubStore((state) => state.run);
  const setActiveOperation = useScrubStore((state) => state.setActiveOperation);

  const kind = name !== undefined && isOperationKind(name) ? name : null;

  // The route is the source of truth for which operation is selected; the store
  // mirrors it so the command bar — which lives outside the route — can follow.
  useEffect(() => {
    setActiveOperation(kind);
  }, [kind, setActiveOperation]);

  if (kind === null) return <Navigate to="/" replace />;

  const descriptor = operationDescriptor(kind);
  const hasFile = meta !== null && uploadId !== null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-heading text-ink">{descriptor.label}</h1>
        <p className="text-micro text-muted mt-0.5">{descriptor.blurb}</p>
      </div>

      {hasFile ? (
        <MediaWell id={uploadId} meta={meta} />
      ) : load.status === 'restoring' ? (
        <div className="bg-well flex min-h-48 flex-1 items-center justify-center rounded-well">
          <p className="text-label text-token-transport">Looking for the file you had open…</p>
        </div>
      ) : (
        // Landing here from a bookmark or a reload with nothing loaded used to be
        // a dead end that just said "No file loaded". The way forward has to be
        // on the screen the user actually arrived at — and at the same size as on
        // the home page, because it is the same invitation.
        <Dropzone
          headline={`Drop a file to ${descriptor.label.toLowerCase()}`}
          hint="Nothing is loaded yet. Drop a video or audio file here, or choose one. Trim, compress, convert, resize, GIF, extract or replace audio, or normalise loudness."
        />
      )}

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
          <p className="text-label text-ink">
            Done — {run.outputName}. Use the button in the command bar to save it.
          </p>
        ) : (
          <p className="text-label text-muted">
            {kind === 'trim'
              ? 'Trim controls are not built yet — the command bar covers the whole clip.'
              : `Controls for ${descriptor.label.toLowerCase()} are not built yet.`}
          </p>
        )}
      </div>
    </div>
  );
}
