import { isOperationKind, operationDescriptor } from '@scrub/shared';
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';

import { useScrubStore } from '@/store/use-scrub-store';

/**
 * Centre panel for `/op/:name`. The well holds its size so the layout does not
 * jump when the operation changes, which is the behaviour the controls below it
 * will depend on.
 */
export function OperationPanel() {
  const { name } = useParams();
  const meta = useScrubStore((state) => state.meta);
  const setActiveOperation = useScrubStore((state) => state.setActiveOperation);

  const kind = name !== undefined && isOperationKind(name) ? name : null;

  // The route is the source of truth for which operation is selected; the store
  // mirrors it so the command bar — which lives outside the route — can follow.
  useEffect(() => {
    setActiveOperation(kind);
  }, [kind, setActiveOperation]);

  if (kind === null) {
    return <Navigate to="/" replace />;
  }

  const descriptor = operationDescriptor(kind);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-heading text-ink">{descriptor.label}</h1>
        <p className="text-micro text-muted mt-0.5">{descriptor.blurb}</p>
      </div>

      <div className="bg-well flex min-h-48 flex-1 items-center justify-center rounded-well">
        {meta ? (
          <p className="text-label text-token-transport tabular-nums">
            {meta.video
              ? `${String(meta.video.width)}×${String(meta.video.height)} ${meta.video.codec}`
              : `${meta.audio?.codec ?? 'audio'} — no video stream`}
          </p>
        ) : (
          <p className="text-label text-token-transport">No file loaded</p>
        )}
      </div>

      <div className="border-line bg-surface rounded-control border p-4">
        <p className="text-label text-muted">
          {kind === 'trim'
            ? 'Trim controls are not built yet — the command bar shows the whole clip.'
            : `Controls for ${descriptor.label.toLowerCase()} are not built yet.`}
        </p>
      </div>
    </div>
  );
}
