import { useCallback, useRef, useState } from 'react';

import { ApiError, uploadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * An empty screen is an invitation, not a mood. The one place in Scrub with
 * centred text, and the only place the dropzone is the whole surface rather than
 * the well.
 */
export function EmptyState() {
  const load = useScrubStore((state) => state.load);
  const startUpload = useScrubStore((state) => state.startUpload);
  const setUploadProgress = useScrubStore((state) => state.setUploadProgress);
  const loadUpload = useScrubStore((state) => state.loadUpload);
  const failUpload = useScrubStore((state) => state.failUpload);

  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      startUpload(file.name);
      uploadFile(file, setUploadProgress)
        .then((result) => {
          loadUpload(result.id, result.meta);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) {
            failUpload(error.message, error.detail);
          } else {
            failUpload('The upload failed before it reached Scrub.');
          }
        });
    },
    [startUpload, setUploadProgress, loadUpload, failUpload],
  );

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
    <div
      className="flex h-full min-h-64 items-center justify-center"
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => {
        setIsOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        accept(event.dataTransfer.files[0]);
      }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-well border border-dashed px-6 py-16 text-center transition-colors duration-100',
          isOver ? 'border-accent bg-surface/60' : 'border-line-strong',
        )}
      >
        <p className="text-display text-ink">Drop a video or audio file</p>
        <p className="text-micro text-muted max-w-md">
          Trim, compress, convert, resize, make a GIF, extract or replace audio, or normalise
          loudness. The exact ffmpeg command is shown before anything runs.
        </p>
        {load.status === 'failed' && (
          <div className="mt-4 max-w-lg text-left">
            <p className="text-label text-ink">{load.message}</p>
            {load.detail.length > 0 && (
              <pre className="text-micro text-muted mt-1 overflow-x-auto whitespace-pre-wrap">
                {load.detail.join('\n')}
              </pre>
            )}
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // Reset so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />
    </div>
  );
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-64 items-center justify-center">
      <div className="border-line flex h-full w-full flex-col items-center justify-center gap-2 rounded-well border border-dashed px-6 py-16 text-center">
        {children}
      </div>
    </div>
  );
}
