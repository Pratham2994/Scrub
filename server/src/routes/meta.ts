import { Router } from 'express';

import type { FfmpegTools } from '../ffmpeg/locate.js';
import { ProbeFailed, probeFile } from '../ffmpeg/probe.js';
import { idParamsSchema } from '../schemas.js';
import { getFile, putFile, recentSources } from '../store.js';
import type { ApiError } from './errors.js';

export function metaRouter(tools: FfmpegTools): Router {
  const router = Router();

  /**
   * The files still in the working folder, so one can be picked up again
   * without being uploaded a second time.
   *
   * Capped at six: this is a shortcut on an empty screen, not a file manager.
   */
  router.get('/recent', (_req, res) => {
    res.json({
      files: recentSources(6).map((file) => ({
        id: file.id,
        displayName: file.displayName,
        meta: file.meta,
      })),
    });
  });

  router.get('/meta/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: { code: 'BAD_ID', message: 'Not a known upload id.' },
      } satisfies ApiError);
      return;
    }

    const file = getFile(params.data.id);
    if (!file) {
      // Also the answer when the TTL sweeper has been through: from the client's
      // side "expired" and "never existed" need the same recovery, which is to
      // load the file again.
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That file is no longer loaded. Drop it again.' },
      } satisfies ApiError);
      return;
    }

    if (file.meta) {
      res.json(file.meta);
      return;
    }

    void (async () => {
      /**
       * An output, probed on demand.
       *
       * Sources are probed on upload because the workspace is built around what
       * they contain. Outputs were not, because nothing needed to know - until
       * a result could become the next source, at which point it needs exactly
       * the same duration, streams and dimensions any other file does.
       *
       * Probing here rather than after every run keeps the cost on the one path
       * that actually wants it: most results are saved and never looked at again.
       */
      try {
        const meta = await probeFile(tools.ffprobe, file.path, file.displayName);
        putFile({ ...file, meta });
        res.json(meta);
      } catch (error) {
        if (error instanceof ProbeFailed) {
          res.status(415).json({
            error: {
              code: 'UNREADABLE',
              message: 'ffprobe could not read that file.',
              detail: error.stderr.trimEnd().split('\n').slice(-15),
            },
          } satisfies ApiError);
          return;
        }
        res.status(500).json({
          error: { code: 'PROBE_FAILED', message: 'Could not read that file.' },
        } satisfies ApiError);
      }
    })();
  });

  return router;
}
