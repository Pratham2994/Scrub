import type { ProbeResult } from '@scrub/shared';

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
