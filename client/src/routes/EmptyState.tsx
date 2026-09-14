/**
 * An empty screen is an invitation, not a mood. The one place in Scrub with centred
 * text, and the only place the dropzone is the whole surface rather than the well.
 */
export function EmptyState() {
  return (
    <div className="flex h-full min-h-64 items-center justify-center">
      <div className="border-line-strong flex h-full w-full flex-col items-center justify-center gap-2 rounded-well border border-dashed px-6 py-16 text-center">
        <p className="text-display text-ink">Drop a video or audio file</p>
        <p className="text-micro text-muted max-w-md">
          Trim, compress, convert, resize, make a GIF, extract or replace audio, or normalise
          loudness. The exact ffmpeg command is shown before anything runs.
        </p>
      </div>
    </div>
  );
}
