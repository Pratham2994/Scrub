import { Router } from 'express';

import { idParamsSchema } from '../schemas.js';
import { getFile } from '../store.js';
import type { ApiError } from './errors.js';

export function metaRouter(): Router {
  const router = Router();

  router.get('/meta/:id', (req, res) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: { code: 'BAD_ID', message: 'Not a known upload id.' },
      } satisfies ApiError);
      return;
    }

    const file = getFile(params.data.id);
    if (!file?.meta) {
      // Also the answer when the TTL sweeper has been through: from the client's
      // side "expired" and "never existed" need the same recovery, which is to
      // load the file again.
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That file is no longer loaded. Drop it again.' },
      } satisfies ApiError);
      return;
    }

    res.json(file.meta);
  });

  return router;
}
