import type {
  AudioFormat,
  OperationKind,
  ProbeResult,
  TrimMode,
  VideoContainer,
} from '@scrub/shared';
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
      /**
       * Whether `progress` is a real fraction. GIF's palette pass writes one
       * image, so ffmpeg has no output timeline to report against and the bar
       * says it is working instead of showing a number that never moves.
       */
      readonly determinate: boolean;
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

/**
 * What every other operation's controls are set to.
 *
 * All of them at once rather than only the selected one, so switching to an
 * operation and back does not silently reset what you had dialled in. The
 * defaults are the answer to "what does someone usually want" — CRF 23 is
 * x264's own default, -16 LUFS is the streaming target, 12fps is the rate a GIF
 * stops looking like a slideshow.
 */
export type OperationParams = {
  readonly compress: { readonly crf: number; readonly preset: string };
  readonly convert: { readonly container: VideoContainer };
  readonly resize: { readonly width: number };
  readonly gif: {
    readonly fps: number;
    readonly width: number;
    readonly useRange: boolean;
  };
  readonly extractAudio: { readonly format: AudioFormat };
  readonly replaceAudio: {
    readonly audioId: string | null;
    readonly audioName: string | null;
    /**
     * The replacement's path on the server.
     *
     * The command bar builds its preview with the same buildArgs the server
     * uses, and that needs both inputs. Without the second path the preview
     * threw and Run stayed disabled even though the file was chosen.
     */
    readonly audioPath: string | null;
    readonly durationSec: number | null;
    /** Set while the second file is being uploaded, or when it failed. */
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly audioConvert: { readonly format: AudioFormat; readonly bitrateKbps: number | null };
  readonly loudness: {
    readonly targetI: number;
    readonly targetTP: number;
    readonly targetLRA: number;
  };
};

const DEFAULT_PARAMS: OperationParams = {
  compress: { crf: 23, preset: 'medium' },
  convert: { container: 'mp4' },
  resize: { width: 1280 },
  gif: { fps: 12, width: 480, useRange: true },
  extractAudio: { format: 'mp3' },
  replaceAudio: {
    audioId: null,
    audioName: null,
    audioPath: null,
    durationSec: null,
    status: 'idle',
    error: null,
  },
  audioConvert: { format: 'mp3', bitrateKbps: 192 },
  loudness: { targetI: -16, targetTP: -1.5, targetLRA: 11 },
};

export type ScrubState = {
  readonly uploadId: string | null;
  readonly meta: ProbeResult | null;
  readonly load: LoadState;
  readonly run: RunState;
  readonly activeOperation: OperationKind | null;
  readonly trim: TrimParams;
  readonly params: OperationParams;

  readonly setActiveOperation: (kind: OperationKind | null) => void;
  readonly setTrim: (patch: Partial<TrimParams>) => void;
  readonly setParams: <K extends keyof OperationParams>(
    key: K,
    patch: Partial<OperationParams[K]>,
  ) => void;
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
  params: DEFAULT_PARAMS,

  setTrim: (patch) => {
    set((state) => ({ trim: { ...state.trim, ...patch } }));
  },
  setParams: (key, patch) => {
    set((state) => ({ params: { ...state.params, [key]: { ...state.params[key], ...patch } } }));
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
      // Resize defaults to the source width, which is the only value that is
      // certainly valid for this file. The rest are file-independent.
      params: {
        ...DEFAULT_PARAMS,
        resize: { width: evenWidth(meta.video?.width ?? 1280) },
        replaceAudio: {
          audioId: null,
          audioName: null,
          audioPath: null,
          durationSec: null,
          status: 'idle',
          error: null,
        },
      },
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

/** libx264 needs even dimensions, so a source width of 1921 must not become one. */
function evenWidth(width: number): number {
  return Math.max(2, width - (width % 2));
}
