import { Router } from 'express';

import { idParamsSchema } from '../schemas.js';
import { getFile } from '../store.js';
import type { ApiError } from './errors.js';

/**
 * `dotfiles: 'allow'` is required, not optional.
 *
 * Scrub's working directory is `.tmp`, and Express's `send` refuses any path
 * containing a dot-segment by default - it answers "Not Found" for a file that
 * is plainly there. Without this every preview and every download fails.
 *
 * It is not a traversal risk: the path comes from the store, keyed by a uuid the
 * server minted, and is never assembled from anything the client sent.
 */
const SEND_OPTIONS = { dotfiles: 'allow' } as const;

function notFound(res: Parameters<Parameters<Router['get']>[1]>[1]): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'That file is no longer available.' },
  } satisfies ApiError);
}

export function downloadRouter(): Router {
  const router = Router();

  /**
   * The file behind a `<video src>`.
   *
   * `res.sendFile` handles Range requests, which a video element depends on for
   * seeking - without byte ranges the browser has to fetch the whole file before
   * it can jump anywhere.
   */
  router.get('/source/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      notFound(res);
      return;
    }
    // The id is looked up; it is never joined onto a directory, so
    // `/source/../../etc/passwd` fails as an unknown id rather than resolving.
    const file = getFile(params.data.id);
    if (!file) {
      notFound(res);
      return;
    }
    res.sendFile(file.path, SEND_OPTIONS, (error) => {
      if (error && !res.headersSent) notFound(res);
    });
  });

  router.get('/download/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      notFound(res);
      return;
    }
    const file = getFile(params.data.id);
    if (!file) {
      notFound(res);
      return;
    }
    res.download(file.path, file.displayName, SEND_OPTIONS, (error) => {
      if (error && !res.headersSent) notFound(res);
    });
  });

  return router;
}
