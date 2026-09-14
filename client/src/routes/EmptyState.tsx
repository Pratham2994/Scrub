import { Dropzone } from '@/components/Dropzone';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * An empty screen is an invitation, not a mood. The one place in Scrub with
 * centred text, and the only place the dropzone is the whole surface rather than
 * the well.
 */
export function EmptyState() {
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
        <p className="text-display text-ink">{load.fileName}</p>
        <p className="text-label text-muted tabular-nums">
          Copying into Scrub — {Math.round(load.progress * 100)}%
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

  return (
    <Dropzone
      headline="Drop a video or audio file"
      hint="Trim, compress, convert, resize, make a GIF, extract or replace audio, or normalise loudness. The exact ffmpeg command is shown before anything runs."
    />
  );
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="border-line flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-well border border-dashed px-6 py-16 text-center">
      {children}
    </div>
  );
}
