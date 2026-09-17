import { OPERATIONS } from '@scrub/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { FileStatus } from '@/components/FileStatus';
import { Handoff } from '@/components/Handoff';
import { MediaWell } from '@/components/MediaWell';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * The centre panel at `/`.
 *
 * It has four states, and the one that used to be missing is the important one:
 * after an upload succeeds the file is loaded, and this has to *show* that.
 * Falling back to the dropzone meant the only evidence anything had happened was
 * the file name in the header - so the app looked like it had ignored you.
 */
export function Home() {
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);

  const hasFile = meta !== null && uploadId !== null;

  return (
    /**
     * `h-full` plus a flex column, the same shape OperationPanel uses, and for
     * the same reason: `main` is a block container, so a child's `flex-1` has
     * nothing to stretch against and the page collapses to the height of its
     * content. The dropzone has a `min-h` floor, so it never looked broken, it
     * just sat at the floor, and the recent-files list padded it out enough to
     * hide that until the working folder was emptied.
     *
     * This route is the whole screen either way: the invitation before a file
     * lands, and the file with the next step under it afterwards.
     */
    <div className="flex h-full min-h-0 flex-col">
      <Handoff mode={hasFile ? 'loaded' : 'empty'}>
        {hasFile ? (
          <Loaded id={uploadId} />
        ) : (
          <FileStatus
            headline="Drop a video or audio file"
            hint="Trim, compress, convert, resize, make a GIF, extract or replace audio, or normalise loudness. The exact ffmpeg command is shown before anything runs."
          />
        )}
      </Handoff>
    </div>
  );
}

/**
 * The file is in. Show it, then answer the only question left: what now.
 *
 * The rail already lists everything, so this is not a second menu - it is the
 * four operations people reach for most, sitting where the eye already is after
 * watching the upload finish.
 */
function Loaded({ id }: { readonly id: string }) {
  const meta = useScrubStore((state) => state.meta);
  if (!meta) return null;

  const suggested = OPERATIONS.filter((op) =>
    meta.video === null
      ? ['audio-trim', 'audio-convert', 'loudness'].includes(op.kind)
      : ['trim', 'compress', 'convert', 'gif'].includes(op.kind),
  );

  return (
    <>
      <MediaWell id={id} meta={meta} />

      <div className="border-line bg-surface rounded-control border p-4">
        <p className="text-heading text-ink">Ready. Pick an operation.</p>
        <p className="text-micro text-muted mt-0.5">
          Everything is in the rail on the left. The command bar below shows exactly what will run
          before it runs.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggested.map((op) => (
            <Link
              key={op.kind}
              to={`/op/${op.kind}`}
              className="text-label text-ink border-line-strong hover:border-accent hover:text-accent group flex items-center gap-1.5 rounded-button border px-3 py-2 transition-colors duration-100"
            >
              {op.label}
              <ArrowRight
                aria-hidden
                size={13}
                className="opacity-40 transition-opacity duration-100 group-hover:opacity-100"
              />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
