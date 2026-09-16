import { Dropzone } from '@/components/Dropzone';
import { useScrubStore } from '@/store/use-scrub-store';

type FileStatusProps = {
  readonly headline: string;
  readonly hint: string;
};

/**
 * What the centre panel shows when no file is loaded yet.
 *
 * Both routes render this rather than each deciding for itself. When they did
 * decide separately, `/op/:name` fell back to the dropzone mid-upload and threw
 * the progress away - you dropped a file and the screen looked like it had not
 * noticed.
 */
export function FileStatus({ headline, hint }: FileStatusProps) {
  const load = useScrubStore((state) => state.load);

  if (load.status === 'restoring') {
    return (
      <Frame>
        <p className="text-label text-muted">Looking for the file you had open…</p>
      </Frame>
    );
  }

  if (load.status === 'uploading') {
    return (
      <Frame>
        <p className="text-display text-ink max-w-full truncate">{load.fileName}</p>
        <p className="text-label text-muted tabular-nums">
          Copying into Scrub, {Math.round(load.progress * 100)}%
        </p>
        <div className="bg-line mt-2 h-1 w-64 overflow-hidden rounded-full">
          <div
            className="bg-accent h-full transition-[width] duration-150"
            style={{ width: `${String(Math.round(load.progress * 100))}%` }}
          />
        </div>
      </Frame>
    );
  }

  return <Dropzone headline={headline} hint={hint} />;
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="border-line flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-well border border-dashed px-6 py-10 text-center tall:workspace:min-h-64 tall:workspace:py-16">
      {children}
    </div>
  );
}
