import { useEffect, useState } from 'react';

import { useAcceptFile } from '@/lib/use-upload';
import { cn } from '@/lib/utils';

/**
 * Makes the whole window accept a dropped file, including when one is already
 * loaded.
 *
 * Without this the only drop target was the empty state, so swapping files meant
 * finding "Close file" first - and dragging a file onto a workspace that already
 * has one is the most natural way to say "use this instead".
 *
 * Listeners go on the window rather than a wrapper element because a drag that
 * ends over the video, the rail or the command bar is still a drop onto Scrub.
 */
export function DropTarget({ children }: { readonly children: React.ReactNode }) {
  const accept = useAcceptFile();
  const [over, setOver] = useState(false);

  useEffect(() => {
    // dragenter/dragleave fire for every element crossed, so a counter is the
    // only reliable way to know when the pointer has actually left the window.
    let depth = 0;

    const carriesFile = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (event: DragEvent): void => {
      if (!carriesFile(event)) return;
      depth += 1;
      setOver(true);
    };
    const onOver = (event: DragEvent): void => {
      // Without preventDefault the browser navigates to the file instead.
      if (carriesFile(event)) event.preventDefault();
    };
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      accept(event.dataTransfer?.files[0]);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [accept]);

  return (
    <>
      {children}
      {over && (
        <div
          aria-hidden
          className="border-accent bg-paper/80 pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-well border-2 border-dashed backdrop-blur-sm"
        >
          <p className={cn('text-display text-ink')}>Drop to load this file</p>
        </div>
      )}
    </>
  );
}
