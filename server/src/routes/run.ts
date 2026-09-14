import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { buildArgs, InvalidOperation, NotImplemented } from '@scrub/shared';
import { Router } from 'express';

import { config } from '../config.js';
import type { FfmpegTools } from '../ffmpeg/locate.js';
import { cancelJob, getJob, type JobEvent, startJob, subscribe } from '../jobs.js';
import { runRequestSchema } from '../schemas.js';
import { getFile } from '../store.js';
import type { ApiError } from './errors.js';

/** Containers each operation produces. Trim and mute keep the source's. */
function outputExtension(kind: string, sourcePath: string): string {
  switch (kind) {
    case 'gif':
      return '.gif';
    case 'convert':
      return '.mp4';
    default:
      return path.extname(sourcePath) || '.mp4';
  }
}

function outputBaseName(displayName: string, kind: string, ext: string): string {
  const stem = path.basename(displayName, path.extname(displayName));
  return `${stem}-${kind}${ext}`;
}

export function runRouter(tools: FfmpegTools): Router {
  const router = Router();

  router.post('/run', (req, res) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'That operation is not one Scrub knows how to run.',
          detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        },
      } satisfies ApiError);
      return;
    }

    const source = getFile(parsed.data.id);
    if (!source?.meta) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That file is no longer loaded. Drop it again.' },
      } satisfies ApiError);
      return;
    }

    const op = parsed.data.op;
    const ext = outputExtension(op.kind, source.path);
    const outputName = outputBaseName(source.displayName, op.kind, ext);
    // Same readable-but-unique naming as uploads, so the output path in the
    // command bar says what the file is rather than showing a bare uuid.
    const outputStem = path.basename(outputName, path.extname(outputName));
    const outputPath = path.join(config.tmpDir, `${outputStem}-${randomUUID().slice(0, 8)}${ext}`);

    try {
      // The same call the command bar made. If these ever produced different
      // argv, the preview would be a lie — which is the one thing Scrub must not do.
      const plan = buildArgs(op, source.meta, {
        inputPath: source.path,
        outputPath,
        workDir: config.tmpDir,
      });

      const jobId = startJob({ ffmpeg: tools.ffmpeg, plan, outputPath, outputName });
      res.status(202).json({ jobId });
    } catch (error) {
      if (error instanceof NotImplemented) {
        res.status(501).json({
          error: { code: 'NOT_IMPLEMENTED', message: `${op.kind} is not built yet.` },
        } satisfies ApiError);
        return;
      }
      if (error instanceof InvalidOperation) {
        res.status(400).json({
          error: { code: 'INVALID_OPERATION', message: error.message },
        } satisfies ApiError);
        return;
      }
      throw error;
    }
  });

  /**
   * Progress stream. Separate from POST /run because EventSource can only issue
   * a GET — and separating them means a dropped connection can reattach to a job
   * that is still going rather than starting a second encode.
   */
  router.get('/run/:jobId/events', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No such job.' },
      } satisfies ApiError);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Without this, a proxy in front of the dev server can hold the stream.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: JobEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type !== 'progress') res.end();
    };

    const unsubscribe = subscribe(job, send);
    req.on('close', unsubscribe);
  });

  router.delete('/run/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No such job.' },
      } satisfies ApiError);
      return;
    }
    res.json({ cancelled: cancelJob(job) });
  });

  return router;
}
