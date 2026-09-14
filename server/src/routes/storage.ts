import { Router } from 'express';

import { idSchema } from '../schemas.js';
import { clearTmpDir, storageUsage, sweepTmpDir } from '../tmp.js';

/**
 * What Scrub is holding on disk, and a way to let it go.
 *
 * Worth showing rather than leaving implicit: the working directory is on the
 * user's own machine, it grows with every file they load and every run they
 * make, and until it was visible here a long session could quietly reach
 * gigabytes without anything on screen mentioning it.
 */
export function storageRouter(): Router {
  const router = Router();

  router.get('/storage', (_req, res) => {
    void (async () => {
      res.json(await storageUsage());
    })();
  });

  router.delete('/storage', (req, res) => {
    // Clearing space is something people do while looking at a file they are
    // working on, and deleting it would be a strange reward for tidying up.
    const raw = req.query.keep;
    const parsed = typeof raw === 'string' ? idSchema.safeParse(raw) : null;
    const keep = parsed?.success === true ? parsed.data : null;

    void (async () => {
      const cleared = await clearTmpDir(keep);
      res.json({ ...cleared, usage: await storageUsage() });
    })();
  });

  /** Run the ordinary sweep now, rather than waiting for the interval. */
  router.post('/storage/sweep', (_req, res) => {
    void (async () => {
      const swept = await sweepTmpDir();
      res.json({ ...swept, usage: await storageUsage() });
    })();
  });

  return router;
}
