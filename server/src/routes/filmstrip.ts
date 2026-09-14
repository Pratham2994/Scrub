import { Router } from 'express';

import { FilmstripFailed, filmstripFor, FRAME_COUNT } from '../ffmpeg/filmstrip.js';
import type { FfmpegTools } from '../ffmpeg/locate.js';
import { idParamsSchema } from '../schemas.js';
import { getFile } from '../store.js';
import type { ApiError } from './errors.js';

/** `dotfiles: 'allow'` — the working directory is `.tmp`; see download.ts. */
const SEND_OPTIONS = { dotfiles: 'allow' } as const;

export function filmstripRouter(tools: FfmpegTools): Router {
  const router = Router();

  /**
   * Every frame of the timeline in one image, side by side.
   *
   * Exempt from the client header for the same mechanical reason as `/source`:
   * it is loaded by an `<img>`, which cannot set one. It is a read, it needs an
   * unguessable id, and the Host and Origin checks still apply.
   */
  router.get('/filmstrip/:id', (req, res, next) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Not a known upload id.' },
      } satisfies ApiError);
      return;
    }

    const file = getFile(params.data.id);
    if (!file?.meta) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That file is no longer loaded.' },
      } satisfies ApiError);
      return;
    }

    // Captured before the async closure: narrowing on `file.meta` does not
    // survive into a callback, and the duration is all that is needed there.
    const { durationSec, video } = file.meta;

    if (video === null) {
      // Audio has no frames. Saying so is better than an empty image the client
      // has to guess about.
      res.status(415).json({
        error: { code: 'NO_VIDEO', message: 'This file has no video to make a filmstrip from.' },
      } satisfies ApiError);
      return;
    }

    void (async () => {
      try {
        const strip = await filmstripFor(tools.ffmpeg, params.data.id, file.path, durationSec);
        // The strip is derived from an immutable upload, so it can be cached
        // hard — the id changes whenever the file does.
        res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
        res.setHeader('X-Frame-Count', String(FRAME_COUNT));
        res.sendFile(strip, SEND_OPTIONS, (error) => {
          if (error && !res.headersSent) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'The filmstrip went away.' },
            } satisfies ApiError);
          }
        });
      } catch (error) {
        if (error instanceof FilmstripFailed) {
          res.status(500).json({
            error: {
              code: 'FILMSTRIP_FAILED',
              message: 'ffmpeg could not read frames from this file.',
              detail: error.stderr.trimEnd().split('\n').slice(-10),
            },
          } satisfies ApiError);
          return;
        }
        next(error);
      }
    })();
  });

  return router;
}
