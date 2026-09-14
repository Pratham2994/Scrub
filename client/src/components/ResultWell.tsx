import { Download, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { downloadUrl, outputExists, sourceUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

type Side = 'result' | 'source';

/**
 * What you made, playable, next to what you started with.
 *
 * Without this the loop ends at a download chip and the only way to find out
 * whether the compression went too far is to open the file somewhere else. The
 * comparison is the point: a still frame of a CRF 28 encode next to the
 * original answers "did I ruin it" in about a second.
 *
 * Only the output is offered for saving. The source is already on the user's
 * disk; offering to download it back would be strange.
 */
export function ResultWell({
  sourceId,
  outputId,
  outputName,
  sizeBytes,
  elapsedMs,
  sourceBytes,
  onDismiss,
}: {
  readonly sourceId: string;
  readonly outputId: string;
  readonly outputName: string;
  readonly sizeBytes: number;
  readonly elapsedMs: number;
  readonly sourceBytes: number;
  readonly onDismiss: () => void;
}) {
  const [side, setSide] = useState<Side>('result');
  const isImage = /\.(gif|png|jpe?g|webp)$/i.test(outputName);
  const ratio = sourceBytes > 0 ? sizeBytes / sourceBytes : null;

  /**
   * The result can be swept out from under this panel.
   *
   * Working files expire on a TTL and are evicted against a size ceiling, so a
   * result left on screen while the user goes and does something else may not
   * be there when they come back. `<a download>` has no way to notice: it
   * saved the 404 body under the output's name, so pressing Save produced an
   * 84-byte JSON error called `clip-muted.mp4` and said nothing.
   */
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [outputId]);

  /**
   * Re-check on the way back to the tab. The media element reports a file that
   * was already gone when it loaded, but not one that disappeared afterwards —
   * and "left it open and came back later" is exactly how the TTL catches
   * someone.
   */
  useEffect(() => {
    let cancelled = false;
    const check = (): void => {
      if (document.visibilityState !== 'visible') return;
      void outputExists(outputId).then((exists) => {
        if (!cancelled) setMissing(!exists);
      });
    };
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', check);
    };
  }, [outputId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="bg-well border-well-edge relative flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-well border">
        {missing && side === 'result' ? (
          /**
           * Say what happened and why, in the place the file used to be. The
           * settings above are untouched, so running it again is one press.
           */
          <div className="max-w-md px-6 text-center">
            <p className="text-body text-token-binary">
              This result is no longer in Scrub&rsquo;s working folder.
            </p>
            <p className="text-micro text-token-transport mt-1.5 leading-relaxed">
              Working files are cleared after a while, and when the folder gets too large. Nothing
              was lost from your own disk. Run it again to make another copy.
            </p>
          </div>
        ) : side === 'result' && isImage ? (
          // A GIF is a picture, not a video. An <img> loops it the way the file
          // will actually behave wherever it ends up.
          <img
            src={downloadUrl(outputId)}
            alt={`The ${outputName} Scrub produced`}
            onError={() => {
              setMissing(true);
            }}
            className="h-full max-h-full w-full object-contain"
          />
        ) : (
          <video
            key={side}
            src={side === 'result' ? downloadUrl(outputId) : sourceUrl(sourceId)}
            controls
            playsInline
            preload="metadata"
            onPointerUp={(event) => {
              // Same reason as the main well: a focused video steals Space and
              // the arrows from Scrub's own shortcuts.
              event.currentTarget.blur();
            }}
            onError={() => {
              // Only the result can go missing. The source is held for as long
              // as the file is loaded.
              if (side === 'result') setMissing(true);
            }}
            className="h-full max-h-full w-full object-contain"
          />
        )}

        <div className="absolute top-3 left-3 flex gap-0.5 rounded-button bg-black/55 p-0.5 backdrop-blur-sm">
          {(['result', 'source'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={side === value}
              onClick={() => {
                setSide(value);
              }}
              className={cn(
                'text-micro rounded-button px-2.5 py-1 transition-colors duration-100',
                side === value ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white',
              )}
            >
              {value === 'result' ? 'Result' : 'Original'}
            </button>
          ))}
        </div>
      </div>

      <div className="border-line bg-surface flex flex-wrap items-center gap-x-6 gap-y-3 rounded-control border p-3">
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink truncate font-mono">{outputName}</p>
          <p className="text-micro text-muted mt-0.5 tabular-nums">
            {missing && 'No longer on disk, was '}
            {formatBytes(sizeBytes)}
            {ratio !== null && (
              <>
                {', '}
                {ratio < 0.98
                  ? `${String(Math.round((1 - ratio) * 100))} percent smaller than the original`
                  : ratio > 1.02
                    ? `${String(Math.round((ratio - 1) * 100))} percent larger than the original`
                    : 'about the same size as the original'}
              </>
            )}
            {', in '}
            {formatElapsed(elapsedMs)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="text-label text-muted hover:text-ink hover:bg-paper flex items-center gap-1.5 rounded-button px-3 py-2 transition-colors duration-100"
          >
            <RotateCcw aria-hidden size={14} />
            Adjust and run again
          </button>
          {missing ? (
            // Not a link. Saving now would write the 404 body to their disk
            // under a name that says it is a video.
            <span
              className="text-label text-muted border-line flex cursor-not-allowed items-center gap-1.5 rounded-button border px-3 py-2"
              title="The file is no longer in Scrub's working folder"
            >
              <Download aria-hidden size={14} />
              Nothing to save
            </span>
          ) : (
            <a
              href={downloadUrl(outputId)}
              download={outputName}
              className="text-label bg-accent text-on-accent flex items-center gap-1.5 rounded-button px-3 py-2 font-medium"
            >
              <Download aria-hidden size={14} />
              Save
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${String(Math.max(1, Math.round(ms)))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(Math.round(seconds % 60))}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
