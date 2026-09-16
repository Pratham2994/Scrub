import { formatTimecode } from '@scrub/shared';
import { useEffect, useState } from 'react';

import { fetchRecent, type RecentFile } from '@/lib/api';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * Files still sitting in the working folder.
 *
 * A clip that was open twenty minutes ago has not gone anywhere: it is on disk,
 * probed, with its filmstrip and waveform already drawn. Asking someone to
 * upload four gigabytes again to carry on with it is asking them to wait for
 * something that already happened.
 *
 * Only on the empty state, and only when there is something to offer. It is a
 * shortcut, not a file manager, which is why nothing here deletes or renames:
 * that lives in Settings, next to the size of the folder it applies to.
 */
export function RecentFiles() {
  const loadUpload = useScrubStore((state) => state.loadUpload);
  const [files, setFiles] = useState<readonly RecentFile[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchRecent()
      .then((found) => {
        if (!cancelled) setFiles(found);
      })
      .catch(() => {
        // Nothing to offer is the same as the request failing, from here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (files.length === 0) return null;

  return (
    <div className="mt-6 w-full max-w-lg">
      <p className="text-micro text-muted mb-2">Still in the working folder</p>
      <div className="flex flex-col gap-1">
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={(event) => {
              // The dropzone wraps this and opens the file picker on click.
              event.stopPropagation();
              loadUpload(file.id, file.meta);
            }}
            className="border-line hover:border-line-strong hover:bg-surface flex items-center gap-3 rounded-control border px-3 py-2 text-left transition-colors duration-100"
          >
            <span className="text-label text-ink min-w-0 flex-1 truncate">{file.displayName}</span>
            <span className="text-micro text-muted shrink-0 tabular-nums">{describe(file)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "0:30 · 1280×720" or "2:14 · audio". Enough to tell two takes apart. */
function describe(file: RecentFile): string {
  const length = formatTimecode(file.meta.durationSec);
  const video = file.meta.video;
  return video === null
    ? `${length} · audio`
    : `${length} · ${String(video.width)}×${String(video.height)}`;
}
