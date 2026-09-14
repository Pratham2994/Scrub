import { Router } from 'express';

import { idParamsSchema } from '../schemas.js';
import { notImplemented } from './errors.js';

export function downloadRouter(): Router {
  const router = Router();

  // The id is matched against the uuid schema and looked up, never joined onto a
  // path. `/download/../../etc/passwd` has to fail as an unknown id, not resolve.
  router.get('/download/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'BAD_ID', message: 'Not a known output id.' } });
      return;
    }
    notImplemented(res, 'GET /download/:id');
  });

  return router;
}
