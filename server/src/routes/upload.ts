import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Router } from 'express';
import multer from 'multer';

import { config } from '../config.js';
import type { FfmpegTools } from '../ffmpeg/locate.js';
import { ProbeFailed, probeFile } from '../ffmpeg/probe.js';
import { putFile } from '../store.js';
import type { ApiError } from './errors.js';

/**
 * A filename built from the user's, reduced to characters that cannot mean
 * anything to a path: no separators, no dots, no leading dash, capped in length.
 * A short uuid is appended so two uploads of the same name cannot collide.
 *
 * The point is the command bar. It shows the real path's basename, so a stored
 * name of `holiday-clip-3036c17e.mp4` makes the displayed command readable while
 * still being exactly the file that gets spawned — readability without the
 * preview and the execution drifting apart.
 */
function safeStem(originalName: string): string {
  const stem = path.basename(originalName, path.extname(originalName));
  const cleaned = stem
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 60);
  return cleaned === '' ? 'upload' : cleaned;
}

/**
 * Disk storage, never memory: a 4 GiB upload buffered in RAM takes the process
 * with it. The extension is kept because some demuxers use it as a hint.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.tmpDir);
  },
  filename: (_req, file, cb) => {
    // path.extname on the *original* name, never the name itself.
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${safeStem(file.originalname)}-${randomUUID().slice(0, 8)}${ext}`);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

export function uploadRouter(tools: FfmpegTools): Router {
  const router = Router();

  router.post('/upload', uploadMiddleware.single('file'), (req, res, next) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({
        error: { code: 'NO_FILE', message: 'No file was attached to the upload.' },
      } satisfies ApiError);
      return;
    }

    void (async () => {
      try {
        const meta = await probeFile(tools.ffprobe, file.path, file.originalname);
        const id = randomUUID();
        putFile({
          id,
          path: file.path,
          displayName: file.originalname,
          meta,
          kind: 'source',
          createdAt: Date.now(),
        });
        res.status(201).json({ id, meta });
      } catch (error) {
        // A file Scrub cannot probe is a file it cannot work on, so it does not
        // keep it. Leaving unusable gigabytes in tmp until the sweeper runs is
        // the kind of thing that fills a disk.
        await fs.rm(file.path, { force: true }).catch(() => undefined);

        if (error instanceof ProbeFailed) {
          res.status(415).json({
            error: {
              code: 'UNREADABLE',
              message: 'ffprobe could not read that file. It may not be audio or video.',
              detail: error.stderr.trimEnd().split('\n').slice(-15),
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
