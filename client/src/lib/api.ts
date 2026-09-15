import type { Operation, ProbeResult } from '@scrub/shared';

/**
 * The server requires this header on everything but the health check. A simple
 * cross-origin request cannot set a custom header, so requiring one forces a
 * preflight — which is what stops a random web page from driving Scrub.
 */
const CLIENT_HEADER = 'X-Scrub-Client';

const BASE = '/api';

export type ApiErrorBody = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: readonly string[];
  };
};

/** Errors are values on the server boundary, so they arrive shaped, not thrown. */
export class ApiError extends Error {
  readonly code: string;
  readonly detail: readonly string[];

  constructor(code: string, message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(body.error.code, body.error.message, body.error.detail ?? []);
  } catch {
    return new ApiError('UNKNOWN', `Scrub's server replied ${String(response.status)}.`);
  }
}

export type UploadResponse = {
  readonly id: string;
  readonly meta: ProbeResult;
};

/**
 * Uploaded with XMLHttpRequest rather than fetch, for one reason: fetch cannot
 * report upload progress. A phone clip is routinely a gigabyte, and the copy into
 * Scrub's working directory is the slowest part of the whole operation — a UI
 * that sits silent through it looks broken.
 */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const request = new XMLHttpRequest();
    request.open('POST', `${BASE}/upload`);
    request.setRequestHeader(CLIENT_HEADER, '1');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as UploadResponse);
        return;
      }
      try {
        const body = JSON.parse(request.responseText) as ApiErrorBody;
        reject(new ApiError(body.error.code, body.error.message, body.error.detail ?? []));
      } catch {
        reject(new ApiError('UNKNOWN', `Upload failed with status ${String(request.status)}.`));
      }
    });

    request.addEventListener('error', () => {
      reject(
        new ApiError(
          'UNREACHABLE',
          "Scrub's server is not responding. Check the terminal where you ran npm run dev.",
        ),
      );
    });

    request.send(form);
  });
}

export async function fetchMeta(id: string): Promise<ProbeResult> {
  const response = await fetch(`${BASE}/meta/${id}`, { headers: { [CLIENT_HEADER]: '1' } });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as ProbeResult;
}

/**
 * `<video src>` and `<a download>` cannot set a request header, so these two
 * routes are the only ones the server lets through without one. Both are
 * side-effect free and need an unguessable id.
 */
export function sourceUrl(id: string): string {
  return `${BASE}/source/${id}`;
}

/** The timeline's frames, as one image. Loaded by an <img>, so no header. */
export function filmstripUrl(id: string): string {
  return `${BASE}/filmstrip/${id}`;
}

/** The audio drawn as a picture, for the timeline. Also loaded by an <img>. */
export function waveformUrl(id: string): string {
  return `${BASE}/waveform/${id}`;
}

export function downloadUrl(id: string): string {
  return `${BASE}/download/${id}`;
}

/**
 * Whether a finished result is still on disk.
 *
 * The working directory is swept on a TTL and evicted against a size ceiling,
 * so a result can be gone while the panel offering it is still on screen. A
 * plain `<a download>` cannot notice: it saved the 404 body under the output's
 * name, handing the user an 84-byte JSON error called `clip-muted.mp4`.
 *
 * HEAD, so this costs nothing on a file that may be gigabytes.
 */
export async function outputExists(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/download/${id}`, {
      method: 'HEAD',
      headers: { [CLIENT_HEADER]: '1' },
    });
    return response.ok;
  } catch {
    // The server being unreachable is a different problem, and claiming the
    // file is missing would send the user off to re-run something that is fine.
    return true;
  }
}

export type HealthResponse = {
  readonly ok: true;
  readonly ffmpeg: { readonly version: string; readonly path: string };
  readonly ffprobe: { readonly version: string; readonly path: string };
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BASE}/health`, { headers: { [CLIENT_HEADER]: '1' } });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as HealthResponse;
}

export type StorageUsage = {
  readonly bytes: number;
  readonly files: number;
  readonly capBytes: number;
};

export async function fetchStorage(): Promise<StorageUsage> {
  const response = await fetch(`${BASE}/storage`, { headers: { [CLIENT_HEADER]: '1' } });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as StorageUsage;
}

/** Empties the working directory, optionally sparing the file on screen. */
export async function clearStorage(keepId: string | null): Promise<StorageUsage> {
  const query = keepId === null ? '' : `?keep=${encodeURIComponent(keepId)}`;
  const response = await fetch(`${BASE}/storage${query}`, {
    method: 'DELETE',
    headers: { [CLIENT_HEADER]: '1' },
  });
  if (!response.ok) throw await toApiError(response);
  const body = (await response.json()) as { usage: StorageUsage };
  return body.usage;
}

export type JobEvent =
  | {
      readonly type: 'progress';
      readonly progress: number;
      /** False while a pass runs that ffmpeg cannot report a fraction for. */
      readonly determinate: boolean;
      readonly passIndex: number;
      readonly passCount: number;
      readonly passLabel: string;
      readonly elapsedMs: number;
    }
  | {
      /** What the loudness measurement pass found, between the two commands. */
      readonly type: 'measured';
      readonly inputI: string;
      readonly inputTP: string;
      readonly inputLRA: string;
    }
  | {
      readonly type: 'done';
      readonly outputId: string;
      readonly outputName: string;
      readonly sizeBytes: number;
      readonly elapsedMs: number;
    }
  | { readonly type: 'error'; readonly message: string; readonly detail: readonly string[] }
  | { readonly type: 'cancelled' };

export type RunTarget = { readonly op: Operation } | { readonly argv: readonly string[] };

export async function startRun(id: string, target: RunTarget): Promise<string> {
  const response = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CLIENT_HEADER]: '1' },
    body: JSON.stringify({ id, ...target }),
  });
  if (!response.ok) throw await toApiError(response);
  const body = (await response.json()) as { jobId: string };
  return body.jobId;
}

/**
 * Attaches to a job's progress stream. Returns a detach function.
 *
 * The server replays what already happened before this connected, because POST
 * /run and this GET are two round trips and a stream copy can finish inside that
 * gap — a fast trim of a short clip regularly does.
 */
export function subscribeToJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const source = new EventSource(`${BASE}/run/${jobId}/events`);

  /**
   * Only a terminal event closes this, and the set is named rather than
   * inferred from "not progress". The loudness measurement arrives between the
   * two passes, and treating it as terminal closed the stream before `done`
   * ever came — the run finished on disk while the bar sat there forever.
   */
  const TERMINAL = new Set(['done', 'error', 'cancelled']);

  source.addEventListener('message', (event: MessageEvent<string>) => {
    const parsed = JSON.parse(event.data) as JobEvent;
    onEvent(parsed);
    if (TERMINAL.has(parsed.type)) source.close();
  });

  source.addEventListener('error', () => {
    // EventSource reconnects on its own, but the server ends the stream after a
    // terminal event — so a closed connection here means "finished", not "broken".
    if (source.readyState === EventSource.CLOSED) return;
    source.close();
    onEvent({ type: 'error', message: 'Lost the connection to Scrub.', detail: [] });
  });

  return () => {
    source.close();
  };
}

export async function cancelRun(jobId: string): Promise<void> {
  await fetch(`${BASE}/run/${jobId}`, {
    method: 'DELETE',
    headers: { [CLIENT_HEADER]: '1' },
  });
}
