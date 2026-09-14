import { Router } from 'express';

import { runRequestSchema } from '../schemas.js';
import { notImplemented } from './errors.js';

export function runRouter(): Router {
  const router = Router();

  // Validate with zod, buildArgs, spawn, stream progress over SSE.
  router.post('/run', (req, res) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'That operation is not one Scrub knows how to run.',
          detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        },
      });
      return;
    }
    notImplemented(res, 'POST /run');
  });

  return router;
}
