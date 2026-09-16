import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { RecentFiles } from '@/components/RecentFiles';
import { useAcceptFile } from '@/lib/use-upload';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/use-theme';
import { useScrubStore } from '@/store/use-scrub-store';

type DropzoneProps = {
  readonly headline: string;
  readonly hint: string;
};

/**
 * The way a file gets into Scrub.
 *
 * The whole area accepts a drop and a click, and there is also a real button -
 * a dashed rectangle reads as a drop target to people who already know the
 * pattern and as nothing at all to people who do not. The outer element is a
 * div rather than a button because a button cannot legally contain another
 * button, and the explicit one has to be a real button to be reachable by
 * keyboard.
 */
export function Dropzone({ headline, hint }: DropzoneProps) {
  const load = useScrubStore((state) => state.load);
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
  const accept = useAcceptFile();
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = (): void => inputRef.current?.click();

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => {
        setIsOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        accept(event.dataTransfer.files[0]);
      }}
      onClick={open}
      className={cn(
        'relative flex h-full min-h-48 flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-well border border-dashed px-6 py-10 text-center transition-colors duration-100',
        'tall:workspace:min-h-64 tall:workspace:py-16',
        isOver ? 'border-accent bg-surface/60' : 'border-line-strong',
      )}
    >
      {phosphor && (
        /**
         * Texture lives where the file isn't: faint scanlines on the empty
         * well, the CRT's idle screen. The dropzone unmounts the moment a
         * file lands, so the lines can never sit under a picture.
         */
        <div aria-hidden className="scanlines pointer-events-none absolute inset-0 rounded-well" />
      )}
      <div className="flex flex-col items-center gap-1">
        <p className="text-display text-ink">{headline}</p>
        <p className="text-micro text-muted max-w-md">{hint}</p>
      </div>

      <button
        type="button"
        onClick={(event) => {
          // The wrapper opens the picker too; without this the click would
          // bubble and open it a second time.
          event.stopPropagation();
          open();
        }}
        className="text-label bg-accent text-on-accent flex items-center gap-1.5 rounded-button px-3 py-2 font-medium"
      >
        <Upload aria-hidden size={14} />
        Choose a file
      </button>

      <RecentFiles />

      {load.status === 'failed' && (
        <div className="mt-2 max-w-lg text-left">
          <p className="text-label text-ink">{load.message}</p>
          {load.detail.length > 0 && (
            <pre className="text-micro text-muted mt-1 overflow-x-auto whitespace-pre-wrap">
              {load.detail.join('\n')}
            </pre>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // Reset so choosing the same file twice in a row still fires a change.
          event.target.value = '';
        }}
      />
    </div>
  );
}
