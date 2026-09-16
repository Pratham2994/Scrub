import type {
  AudioFormat,
  OperationKind,
  ProbeResult,
  TrimMode,
  VideoContainer,
  WatermarkPosition,
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
/**
 * What the loudness measurement pass found. Kept on the run so it survives into
 * the finished state: the point of showing it is that the user can see what the
 * second pass corrected *from*, which is only interesting once it is done.
 */
export type Measurement = {
  readonly inputI: string;
  readonly inputTP: string;
  readonly inputLRA: string;
};

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
      /**
       * How much longer. Elapsed alone answers "has it hung"; on a ten minute
       * encode the question is whether to wait or walk away.
       */
      readonly etaMs: number | null;
      readonly passLabel: string;
      readonly passIndex: number;
      readonly passCount: number;
      readonly elapsedMs: number;
      readonly measurement: Measurement | null;
    }
  | {
      readonly status: 'done';
      readonly outputId: string;
      readonly outputName: string;
      readonly sizeBytes: number;
      readonly elapsedMs: number;
      readonly measurement: Measurement | null;
    }
  | { readonly status: 'failed'; readonly message: string; readonly detail: readonly string[] }
  | { readonly status: 'cancelled' };

/**
 * The id of the file currently loaded, kept in sessionStorage.
 *
 * Per tab, not per browser: two Scrub tabs are two workspaces. It holds only the
 * id - the metadata is refetched from the server on boot, so a file the TTL
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
 * defaults are the answer to "what does someone usually want" - CRF 23 is
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
  readonly targetSize: {
    /** Which preset is selected, or null when the target was typed by hand. */
    readonly presetId: string | null;
    readonly targetMiB: number;
    readonly audioKbps: number;
    readonly maxWidth: number | null;
  };
  readonly speed: { readonly factor: number };
  readonly crop: {
    /**
     * The rectangle as fractions of the frame, not pixels.
     *
     * The user drags it over a preview that is whatever size the window allows,
     * and the same selection has to mean the same crop on a 4K source as on a
     * 480p one. Pixels are worked out once, at the end, against the real
     * dimensions ffprobe reported.
     */
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly audioConvert: { readonly format: AudioFormat; readonly bitrateKbps: number | null };
  readonly loudness: {
    readonly targetI: number;
    readonly targetTP: number;
    readonly targetLRA: number;
  };
  readonly merge: {
    /** Ids of the extra clips, in order. The loaded file is clip 0. */
    readonly clipIds: readonly string[];
    /** The extras' resolved facts, for the client-side preview buildArgs call. */
    readonly clips: readonly {
      readonly id: string;
      readonly name: string;
      readonly path: string;
      readonly meta: ProbeResult;
    }[];
    readonly crossfadeSec: number;
    readonly fadeInSec: number;
    readonly fadeOutSec: number;
    readonly crf: number;
    /** Set while an extra clip is uploading, or when one failed. */
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly mergeAudio: {
    readonly clipIds: readonly string[];
    readonly clips: readonly {
      readonly id: string;
      readonly name: string;
      readonly path: string;
      readonly meta: ProbeResult;
    }[];
    readonly crossfadeSec: number;
    readonly fadeInSec: number;
    readonly fadeOutSec: number;
    readonly bitrateKbps: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly addMusic: {
    readonly musicId: string | null;
    readonly musicName: string | null;
    readonly musicPath: string | null;
    readonly musicMeta: ProbeResult | null;
    readonly originalPercent: number;
    readonly musicPercent: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly watermark: {
    readonly imageId: string | null;
    readonly imageName: string | null;
    readonly imagePath: string | null;
    readonly imageMeta: ProbeResult | null;
    readonly position: WatermarkPosition;
    readonly opacity: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly fade: { readonly fadeInSec: number; readonly fadeOutSec: number };
  readonly audioFade: { readonly fadeInSec: number; readonly fadeOutSec: number };
  readonly loop: { readonly times: number };
  readonly audioLoop: { readonly times: number };
  readonly volume: { readonly gainDb: number };
  readonly audioVolume: { readonly gainDb: number };
};

/**
 * Settings survive the tab, unlike the loaded file.
 *
 * Someone who compresses at CRF 28 does it every time, and being asked again on
 * every visit is the kind of small rudeness that makes a tool feel like it is
 * not paying attention. `localStorage` rather than `sessionStorage` for exactly
 * that reason: the file is per tab, the way you like your encodes is not.
 *
 * Deliberately not stored: anything about a *particular* file. The replacement
 * audio track in `replaceAudio` points at an upload that will have been swept
 * long before the next visit, so it is dropped on the way in and out.
 */
const PARAMS_KEY = 'scrub:params';

function loadParams(defaults: OperationParams): OperationParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw === null) return defaults;
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const merged: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(defaults)) {
      const savedValue = saved[key];
      if (savedValue !== null && typeof savedValue === 'object' && !Array.isArray(savedValue)) {
        /**
         * Merged field by field onto the defaults rather than used as-is. A
         * stored blob from an older version is missing whatever has been added
         * since, and `params.speed.factor` coming back undefined would reach
         * buildArgs as NaN.
         */
        merged[key] = { ...value, ...savedValue };
      }
    }
    return {
      ...(merged as OperationParams),
      replaceAudio: defaults.replaceAudio,
      merge: defaults.merge,
      mergeAudio: defaults.mergeAudio,
      addMusic: defaults.addMusic,
      watermark: defaults.watermark,
    };
  } catch {
    // Corrupt JSON, or a browser refusing storage. The defaults are fine.
    return defaults;
  }
}

function saveParams(params: OperationParams): void {
  try {
    // The extra files belong to one session, so they never go in.
    const {
      replaceAudio: _dropped1,
      merge: _dropped2,
      mergeAudio: _dropped3,
      addMusic: _dropped4,
      watermark: _dropped5,
      ...rest
    } = params;
    localStorage.setItem(PARAMS_KEY, JSON.stringify(rest));
  } catch {
    // Private modes refuse storage. Forgetting a preference is not worth failing over.
  }
}

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
  targetSize: { presetId: 'discord', targetMiB: 9.5, audioKbps: 128, maxWidth: 1280 },
  speed: { factor: 2 },
  // Centred and covering most of the frame: visibly a selection, and a starting
  // point to drag from rather than a puzzle about where the handles went.
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  audioConvert: { format: 'mp3', bitrateKbps: 192 },
  loudness: { targetI: -16, targetTP: -1.5, targetLRA: 11 },
  merge: {
    clipIds: [],
    clips: [],
    crossfadeSec: 0.5,
    fadeInSec: 0,
    fadeOutSec: 0,
    crf: 20,
    status: 'idle',
    error: null,
  },
  mergeAudio: {
    clipIds: [],
    clips: [],
    crossfadeSec: 2,
    fadeInSec: 0,
    fadeOutSec: 0,
    bitrateKbps: 192,
    status: 'idle',
    error: null,
  },
  addMusic: {
    musicId: null,
    musicName: null,
    musicPath: null,
    musicMeta: null,
    originalPercent: 100,
    musicPercent: 35,
    status: 'idle',
    error: null,
  },
  watermark: {
    imageId: null,
    imageName: null,
    imagePath: null,
    imageMeta: null,
    position: 'se',
    opacity: 100,
    status: 'idle',
    error: null,
  },
  fade: { fadeInSec: 1, fadeOutSec: 1 },
  audioFade: { fadeInSec: 1, fadeOutSec: 1 },
  loop: { times: 2 },
  audioLoop: { times: 2 },
  volume: { gainDb: 6 },
  audioVolume: { gainDb: 6 },
};

/**
 * One entry in the queue.
 *
 * The foreground `run` above is what the command bar shows for the operation
 * you are looking at right now. This is the record of everything started,
 * including the encodes still going while you set up the next one - which is
 * the whole reason the queue exists.
 */
export type QueuedJob = {
  readonly jobId: string;
  /** Null for a hand-edited command, which belongs to no operation. */
  readonly kind: OperationKind | null;
  readonly title: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  /** How many are in front of it. 0 once it is running. */
  readonly position: number;
  readonly progress: number;
  readonly determinate: boolean;
  readonly etaMs: number | null;
  readonly passLabel: string;
  readonly elapsedMs: number;
  readonly outputId: string | null;
  readonly outputName: string | null;
  readonly sizeBytes: number | null;
  readonly message: string | null;
};

export type ScrubState = {
  readonly uploadId: string | null;
  readonly meta: ProbeResult | null;
  readonly load: LoadState;
  readonly run: RunState;
  readonly activeOperation: OperationKind | null;
  readonly trim: TrimParams;
  readonly params: OperationParams;
  readonly jobs: readonly QueuedJob[];

  readonly addJob: (job: QueuedJob) => void;
  readonly updateJob: (jobId: string, patch: Partial<QueuedJob>) => void;
  readonly forgetFinishedJobs: () => void;

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
  /**
   * Make a finished result the file being worked on.
   *
   * Never automatic. Chaining trim into compress is common, but so is running
   * three compressions from one source to compare them, and silently swapping
   * the source under someone doing the second would be infuriating. It is a
   * button, and it is pressed on purpose.
   */
  readonly continueFrom: (uploadId: string, meta: ProbeResult) => void;
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
  params: loadParams(DEFAULT_PARAMS),
  jobs: [],

  addJob: (job) => {
    set((state) => ({ jobs: [...state.jobs, job] }));
  },
  updateJob: (jobId, patch) => {
    set((state) => ({
      jobs: state.jobs.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job)),
    }));
  },
  forgetFinishedJobs: () => {
    // Only the ones that are over. Clearing the list must never lose sight of
    // an encode that is still running.
    set((state) => ({
      jobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    }));
  },

  setTrim: (patch) => {
    set((state) => ({ trim: { ...state.trim, ...patch } }));
  },
  setParams: (key, patch) => {
    set((state) => {
      const params = { ...state.params, [key]: { ...state.params[key], ...patch } };
      saveParams(params);
      return { params };
    });
  },

  setActiveOperation: (kind) => {
    set((state) =>
      // Changing operation invalidates a finished result - the "Done" chip belongs
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
    set((state) => ({
      uploadId,
      meta,
      load: { status: 'ready' },
      run: { status: 'idle' },
      // A new file means a new timeline, so the range starts as the whole clip.
      trim: { startSec: 0, endSec: meta.durationSec, mode: 'fast' },
      /**
       * Settings carry over from the last file; only the two that cannot.
       *
       * This used to reset everything to the defaults here, which was right
       * while nothing was remembered and wrong the moment anything was: it
       * threw away the CRF you had just chosen every time you dropped a file.
       *
       * Resize is genuinely file-dependent - the source width is the only value
       * certainly valid for this file - and the replacement audio track points
       * at a different upload entirely.
       */
      params: {
        ...state.params,
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
    }));
  },
  failUpload: (message, detail = []) => {
    rememberUpload(null);
    set({ uploadId: null, meta: null, load: { status: 'failed', message, detail } });
  },
  setRun: (run) => {
    set({ run });
  },
  continueFrom: (uploadId, meta) => {
    rememberUpload(uploadId);
    set({
      uploadId,
      meta,
      load: { status: 'ready' },
      // The result panel belongs to the run that produced it, and that run is
      // now the source rather than the output.
      run: { status: 'idle' },
      trim: { startSec: 0, endSec: meta.durationSec, mode: 'fast' },
    });
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
