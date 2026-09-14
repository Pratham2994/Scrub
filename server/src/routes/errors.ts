import type { Response } from 'express';

/**
 * Errors are values on the server boundary — nothing throws across an HTTP or SSE
 * response. One shape, so the client has one thing to render.
 */
export type ApiError = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Last lines of ffmpeg's stderr, when there are any. */
    readonly detail?: readonly string[];
  };
};

export function notImplemented(res: Response, route: string): void {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: `${route} is scaffolded but not implemented yet.`,
    },
  } satisfies ApiError);
}
