import type { OperationKind, ProbeResult } from '@scrub/shared';
import { create } from 'zustand';

/** Where the loaded file is in its journey. The UI reads this, not a pile of booleans. */
export type LoadState =
  | { readonly status: 'empty' }
  | { readonly status: 'uploading'; readonly fileName: string; readonly progress: number }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string; readonly detail: readonly string[] };

/**
 * One workspace, so one store. The loaded file *is* the state — routes swap the
 * centre panel, they do not swap what is loaded.
 */
export type ScrubState = {
  readonly uploadId: string | null;
  readonly meta: ProbeResult | null;
  readonly load: LoadState;
  readonly activeOperation: OperationKind | null;

  readonly setActiveOperation: (kind: OperationKind | null) => void;
  readonly startUpload: (fileName: string) => void;
  readonly setUploadProgress: (fraction: number) => void;
  readonly loadUpload: (uploadId: string, meta: ProbeResult) => void;
  readonly failUpload: (message: string, detail?: readonly string[]) => void;
  readonly reset: () => void;
};

export const useScrubStore = create<ScrubState>()((set) => ({
  uploadId: null,
  meta: null,
  load: { status: 'empty' },
  activeOperation: null,

  setActiveOperation: (kind) => {
    set({ activeOperation: kind });
  },
  startUpload: (fileName) => {
    set({ load: { status: 'uploading', fileName, progress: 0 }, uploadId: null, meta: null });
  },
  setUploadProgress: (fraction) => {
    set((state) =>
      state.load.status === 'uploading'
        ? { load: { ...state.load, progress: fraction } }
        : // A progress event arriving after the upload resolved must not drag the
          // UI back into the uploading state.
          state,
    );
  },
  loadUpload: (uploadId, meta) => {
    set({ uploadId, meta, load: { status: 'ready' } });
  },
  failUpload: (message, detail = []) => {
    set({ uploadId: null, meta: null, load: { status: 'failed', message, detail } });
  },
  reset: () => {
    set({ uploadId: null, meta: null, load: { status: 'empty' }, activeOperation: null });
  },
}));
