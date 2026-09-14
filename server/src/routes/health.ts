import { Router } from 'express';

import type { FfmpegTools } from '../ffmpeg/locate.js';

export type HealthResponse = {
  readonly ok: true;
  readonly ffmpeg: { readonly version: string; readonly path: string };
  readonly ffprobe: { readonly version: string; readonly path: string };
};

/**
 * Reports the binaries Scrub resolved at boot.
 *
 * There is no unhealthy response: the process refuses to start without both tools,
 * so a failed health check reaches the client as a connection error, and the real
 * diagnosis is already printed in the terminal. The client should say so rather
 * than inventing a reason.
 */
export function healthRouter(tools: FfmpegTools): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      ffmpeg: { version: tools.ffmpeg.version, path: tools.ffmpeg.path },
      ffprobe: { version: tools.ffprobe.version, path: tools.ffprobe.path },
    } satisfies HealthResponse);
  });

  return router;
}
