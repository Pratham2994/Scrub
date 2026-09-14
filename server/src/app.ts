import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { FfmpegTools } from './ffmpeg/locate.js';
import { downloadRouter } from './routes/download.js';
import type { ApiError } from './routes/errors.js';
import { healthRouter } from './routes/health.js';
import { metaRouter } from './routes/meta.js';
import { runRouter } from './routes/run.js';
import { uploadRouter } from './routes/upload.js';
import { localOnly } from './security.js';

export function createApp(tools: FfmpegTools): Express {
  const app = express();

  // Nothing about the server's software is anyone's business.
  app.disable('x-powered-by');

  // Before every route, including health: the guard is the security boundary and
  // must not be something a future route can forget to opt into.
  app.use(localOnly);

  // Modest: the only large body Scrub takes is a multipart upload, and multer
  // handles that stream separately.
  app.use(express.json({ limit: '256kb' }));

  app.use(healthRouter(tools));
  app.use(uploadRouter(tools));
  app.use(metaRouter());
  app.use(runRouter(tools));
  app.use(downloadRouter());

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No such route.' },
    } satisfies ApiError);
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    res.status(500).json({
      error: { code: 'INTERNAL', message },
    } satisfies ApiError);
  });

  return app;
}
