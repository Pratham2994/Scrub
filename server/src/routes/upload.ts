import { Router } from 'express';
import multer from 'multer';

import { config } from '../config.js';
import { notImplemented } from './errors.js';

/**
 * Disk storage, never memory: a 4 GiB upload buffered in RAM takes the process with
 * it. Wired here and left unused until the route is real — attaching it now would
 * mean accepting a multi-gigabyte body only to answer 501.
 */
export const uploadMiddleware = multer({
  dest: config.tmpDir,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

export function uploadRouter(): Router {
  const router = Router();

  // POST multipart -> tmp, ffprobe, returns { id, meta }
  router.post('/upload', (_req, res) => {
    notImplemented(res, 'POST /upload');
  });

  return router;
}
