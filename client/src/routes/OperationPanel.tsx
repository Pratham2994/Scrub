import { isOperationKind, operationDescriptor } from '@scrub/shared';
import { Navigate, useParams } from 'react-router';

/**
 * Centre panel for `/op/:name`. Static in this scaffold: the well holds its size so
 * the layout does not jump when the operation changes, which is the behaviour the
 * controls below it will depend on.
 */
export function OperationPanel() {
  const { name } = useParams();

  if (name === undefined || !isOperationKind(name)) {
    return <Navigate to="/" replace />;
  }

  const descriptor = operationDescriptor(name);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-heading text-ink">{descriptor.label}</h1>
        <p className="text-micro text-muted mt-0.5">{descriptor.blurb}</p>
      </div>

      <div className="bg-well flex min-h-48 flex-1 items-center justify-center rounded-well">
        <p className="text-label text-token-transport">No file loaded</p>
      </div>

      <div className="border-line bg-surface rounded-control border p-4">
        <p className="text-label text-muted">
          Controls for {descriptor.label.toLowerCase()} are not built yet.
        </p>
      </div>
    </div>
  );
}
