import { useCallback, useEffect, useRef } from 'react';

import { ApiError, fetchMeta, uploadFile } from '@/lib/api';
import { recallUpload, useScrubStore } from '@/store/use-scrub-store';

/**
 * Accepts a file from anywhere - the dropzone, the file picker, a drop on the
 * operation panel. One implementation so every entry point behaves identically.
 */
export function useAcceptFile(): (file: File | undefined | null) => void {
  const startUpload = useScrubStore((state) => state.startUpload);
  const setUploadProgress = useScrubStore((state) => state.setUploadProgress);
  const loadUpload = useScrubStore((state) => state.loadUpload);
  const failUpload = useScrubStore((state) => state.failUpload);

  return useCallback(
    (file) => {
      if (!file) return;
      startUpload(file.name);
      uploadFile(file, setUploadProgress)
        .then((result) => {
          loadUpload(result.id, result.meta);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) failUpload(error.message, error.detail);
          else failUpload('The upload failed before it reached Scrub.');
        });
    },
    [startUpload, setUploadProgress, loadUpload, failUpload],
  );
}

/**
 * Puts the workspace back after a reload.
 *
 * The id survives in sessionStorage but the metadata is refetched, so a file the
 * TTL sweeper has since deleted resolves to an empty workspace instead of a UI
 * built around a path that no longer exists. Runs once per mount, and guards
 * against React 19's double-invoked effects in development.
 */
export function useRestoreUpload(): void {
  const beginRestore = useScrubStore((state) => state.beginRestore);
  const loadUpload = useScrubStore((state) => state.loadUpload);
  const clearFile = useScrubStore((state) => state.clearFile);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const id = recallUpload();
    if (id === null) return;

    beginRestore();
    fetchMeta(id)
      .then((meta) => {
        loadUpload(id, meta);
      })
      .catch(() => {
        // Expired, swept, or the server restarted. All of them mean the same
        // thing to the user: the file needs loading again.
        clearFile();
      });
  }, [beginRestore, loadUpload, clearFile]);
}
