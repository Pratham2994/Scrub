import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { buildArgs, InvalidOperation, NotImplemented, type Operation } from '@scrub/shared';
import { Router } from 'express';

import { config } from '../config.js';
import type { FfmpegTools } from '../ffmpeg/locate.js';
import { cancelJob, getJob, type JobEvent, startJob, subscribe } from '../jobs.js';
import { runRequestSchema } from '../schemas.js';
import { getFile } from '../store.js';
import type { ApiError } from './errors.js';

/**
 * The container each operation produces.
 *
 * ffmpeg picks its muxer from the output extension, so this is not cosmetic —
 * getting it wrong produces a file with the right bytes and the wrong wrapper.
 * Operations that do not change the container keep the source's.
 */
function outputExtension(op: Operation, sourcePath: string): string {
  switch (op.kind) {
    case 'gif':
      return '.gif';
    case 'convert':
      return `.${op.container}`;
    case 'extract-audio':
    case 'audio-convert':
      // m4a is the container people expect around an AAC track. ".aac" makes
      // ffmpeg write a raw ADTS stream, which many players will not open.
      return op.format === 'aac' ? '.m4a' : `.${op.format}`;
    case 'trim':
    case 'compress':
    case 'resize':
    case 'mute':
    case 'replace-audio':
    case 'audio-trim':
    case 'loudness':
      return path.extname(sourcePath) || '.mp4';
  }
}

function outputBaseName(displayName: string, kind: string, ext: string): string {
  const stem = path.basename(displayName, path.extname(displayName));
  return `${stem}-${kind}${ext}`;
}

/**
 * How long an edited command's output should be, for the progress denominator.
 *
 * `-t` states it outright; `-to` minus `-ss` gives it; otherwise the whole source
 * is the best guess. A guess is fine here — being wrong makes the bar finish
 * early or late, where having no denominator at all means no bar.
 */
function estimateDuration(argv: readonly string[], sourceDuration: number): number {
  const valueOf = (flag: string): number | null => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const raw = argv[index + 1];
    if (raw === undefined) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const t = valueOf('-t');
  if (t !== null && t > 0) return t;

  const to = valueOf('-to');
  if (to !== null) {
    const ss = valueOf('-ss') ?? 0;
    if (to - ss > 0) return to - ss;
  }

  return sourceDuration;
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

    // An edited command runs exactly as typed. buildArgs is bypassed because
    // there is no operation to build from — the user's argv *is* the plan.
    if ('argv' in parsed.data) {
      const argv = parsed.data.argv;
      const last = argv[argv.length - 1] ?? '';
      const editedOutput = path.isAbsolute(last) ? last : path.join(config.tmpDir, last);
      const jobId = startJob({
        ffmpeg: tools.ffmpeg,
        plan: {
          passes: [
            {
              argv,
              label: 'Edited command',
              outputDurationSec: estimateDuration(argv, source.meta.durationSec),
            },
          ],
        },
        outputPath: editedOutput,
        outputName: path.basename(editedOutput),
      });
      res.status(202).json({ jobId });
      return;
    }

    const op = parsed.data.op;
    const ext = outputExtension(op, source.path);
    const outputName = outputBaseName(source.displayName, op.kind, ext);
    // Same readable-but-unique naming as uploads, so the output path in the
    // command bar says what the file is rather than showing a bare uuid.
    const outputStem = path.basename(outputName, path.extname(outputName));
    const outputPath = path.join(config.tmpDir, `${outputStem}-${randomUUID().slice(0, 8)}${ext}`);

    try {
      // The same call the command bar made. If these ever produced different
      // argv, the preview would be a lie — which is the one thing Scrub must not do.
      // replace-audio takes a second upload; resolve its id to a path here so
      // buildArgs stays pure and never touches the store.
      let secondaryInputPath: string | undefined;
      if (op.kind === 'replace-audio') {
        const replacement = getFile(op.audioId);
        if (!replacement) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'That replacement audio file is no longer loaded.',
            },
          } satisfies ApiError);
          return;
        }
        secondaryInputPath = replacement.path;
      }

      const plan = buildArgs(op, source.meta, {
        inputPath: source.path,
        outputPath,
        workDir: config.tmpDir,
        ...(secondaryInputPath === undefined ? {} : { secondaryInputPath }),
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
