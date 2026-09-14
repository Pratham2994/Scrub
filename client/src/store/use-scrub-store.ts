import type { OperationKind, ProbeResult, TrimMode } from '@scrub/shared';
import { create } from 'zustand';

/** Where the loaded file is in its journey. The UI reads this, not a pile of booleans. */
export type LoadState =
  | { readonly status: 'empty' }
  /** A reload happened and the previous file is being re-checked against the server. */
  | { readonly status: 'restoring' }
  | { readonly status: 'uploading'; readonly fileName: string; readonly progress: number }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string; readonly detail: readonly string[] };

/** Where a Run is in its journey. */
export type RunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly jobId: string;
      readonly progress: number;
      readonly passLabel: string;
      readonly passIndex: number;
      readonly passCount: number;
      readonly elapsedMs: number;
    }
  | {
      readonly status: 'done';
      readonly outputId: string;
      readonly outputName: string;
      readonly sizeBytes: number;
      readonly elapsedMs: number;
    }
  | { readonly status: 'failed'; readonly message: string; readonly detail: readonly string[] }
  | { readonly status: 'cancelled' };

/**
 * The id of the file currently loaded, kept in sessionStorage.
 *
 * Per tab, not per browser: two Scrub tabs are two workspaces. It holds only the
 * id — the metadata is refetched from the server on boot, so a file the TTL
 * sweeper has removed is discovered immediately rather than rendering a
 * workspace around a file that is gone.
 */
const UPLOAD_KEY = 'scrub:uploadId';

export function rememberUpload(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(UPLOAD_KEY);
    else sessionStorage.setItem(UPLOAD_KEY, id);
  } catch {
    // Private modes can refuse storage. Losing the file on reload is a smaller
    // failure than refusing to run at all.
  }
}

export function recallUpload(): string | null {
  try {
    return sessionStorage.getItem(UPLOAD_KEY);
  } catch {
    return null;
  }
}

/** Trim's controls. Lives here because the command bar renders from it too. */
export type TrimParams = {
  readonly startSec: number;
  readonly endSec: number;
  readonly mode: TrimMode;
};

export type ScrubState = {
  readonly uploadId: string | null;
  readonly meta: ProbeResult | null;
  readonly load: LoadState;
  readonly run: RunState;
  readonly activeOperation: OperationKind | null;
  readonly trim: TrimParams;

  readonly setActiveOperation: (kind: OperationKind | null) => void;
  readonly setTrim: (patch: Partial<TrimParams>) => void;
  readonly beginRestore: () => void;
  readonly startUpload: (fileName: string) => void;
  readonly setUploadProgress: (fraction: number) => void;
  readonly loadUpload: (uploadId: string, meta: ProbeResult) => void;
  readonly failUpload: (message: string, detail?: readonly string[]) => void;
  readonly setRun: (run: RunState) => void;
  readonly clearFile: () => void;
  readonly reset: () => void;
};

export const useScrubStore = create<ScrubState>()((set) => ({
  uploadId: null,
  meta: null,
  load: { status: 'empty' },
  run: { status: 'idle' },
  activeOperation: null,
  trim: { startSec: 0, endSec: 0, mode: 'fast' },

  setTrim: (patch) => {
    set((state) => ({ trim: { ...state.trim, ...patch } }));
  },

  setActiveOperation: (kind) => {
    set((state) =>
      // Changing operation invalidates a finished result — the "Done" chip belongs
      // to the operation that produced it, not to whatever is selected now.
      state.activeOperation === kind
        ? { activeOperation: kind }
        : { activeOperation: kind, run: { status: 'idle' } },
    );
  },
  beginRestore: () => {
    set({ load: { status: 'restoring' } });
  },
  startUpload: (fileName) => {
    rememberUpload(null);
    set({
      load: { status: 'uploading', fileName, progress: 0 },
      uploadId: null,
      meta: null,
      run: { status: 'idle' },
    });
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
    rememberUpload(uploadId);
    set({
      uploadId,
      meta,
      load: { status: 'ready' },
      run: { status: 'idle' },
      // A new file means a new timeline, so the range starts as the whole clip.
      trim: { startSec: 0, endSec: meta.durationSec, mode: 'fast' },
    });
  },
  failUpload: (message, detail = []) => {
    rememberUpload(null);
    set({ uploadId: null, meta: null, load: { status: 'failed', message, detail } });
  },
  setRun: (run) => {
    set({ run });
  },
  clearFile: () => {
    rememberUpload(null);
    set({ uploadId: null, meta: null, load: { status: 'empty' }, run: { status: 'idle' } });
  },
  reset: () => {
    rememberUpload(null);
    set({
      uploadId: null,
      meta: null,
      load: { status: 'empty' },
      run: { status: 'idle' },
      activeOperation: null,
    });
  },
}));
