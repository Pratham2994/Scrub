import { Router } from 'express';

import { idParamsSchema } from '../schemas.js';
import { notImplemented } from './errors.js';

export function metaRouter(): Router {
  const router = Router();

  // GET probed duration, streams, codecs, dimensions -> ProbeResult
  router.get('/meta/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'BAD_ID', message: 'Not a known upload id.' } });
      return;
    }
    notImplemented(res, 'GET /meta/:id');
  });

  return router;
}
