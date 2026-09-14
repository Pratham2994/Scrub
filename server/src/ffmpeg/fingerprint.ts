import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

/** Bytes read from each end of the file. */
const SAMPLE = 1024 * 1024;

/**
 * Identifies a file well enough to notice it has been dropped twice.
 *
 * Not a full hash of the contents. A 4 GB video would have to be read end to end
 * to produce one, doubling the I/O of every upload to answer a question that is
 * usually "no". This reads the first and last megabyte along with the exact byte
 * length, which for media files is decisive: containers carry their header at
 * the front and their index at the back, and two different videos agreeing on
 * both plus their exact size is not something that happens.
 *
 * The cost of being wrong would be operating on the wrong file, so this is
 * deliberately conservative: any difference in length alone is enough to treat
 * two files as unrelated.
 */
export async function fingerprintFile(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const hash = createHash('sha256');
    hash.update(String(size));

    const head = Buffer.alloc(Math.min(SAMPLE, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);

    if (size > SAMPLE) {
      const tailLength = Math.min(SAMPLE, size - SAMPLE);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      hash.update(tail);
    }

    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
