import { Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { fetchHealth, type HealthResponse } from '@/lib/api';
import { type Theme, useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';

const THEMES: readonly {
  readonly value: Theme;
  readonly label: string;
  readonly icon: typeof Sun;
}[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * The gear. Appearance, and what Scrub is actually running.
 *
 * The ffmpeg version belongs here rather than buried in a terminal: when an
 * operation fails for a reason that turns out to be a build difference, the
 * first question is which ffmpeg this is, and the answer should be one click
 * away.
 */
export function SettingsPanel() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetched when the panel first opens, not on mount: it is a detail nobody
  // needs until they come looking for it.
  useEffect(() => {
    if (!open || health !== null) return;
    fetchHealth()
      .then(setHealth)
      .catch(() => {
        setHealth(null);
      });
  }, [open, health]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={cn(
          'rounded-button p-1.5 transition-colors duration-100',
          open ? 'bg-surface text-ink' : 'text-muted hover:text-ink hover:bg-surface',
        )}
      >
        <Settings aria-hidden size={16} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Settings"
          className="border-line bg-surface absolute right-0 z-20 mt-2 w-72 rounded-control border p-4 shadow-lg"
        >
          <fieldset>
            <legend className="text-label text-muted mb-2">Appearance</legend>
            <div className="border-line grid grid-cols-3 gap-1 rounded-control border p-1">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => {
                    setTheme(value);
                  }}
                  className={cn(
                    'text-label flex flex-col items-center gap-1 rounded-button px-2 py-2 transition-colors duration-100',
                    theme === value
                      ? 'bg-well text-white font-medium'
                      : 'text-muted hover:text-ink hover:bg-paper',
                  )}
                >
                  <Icon aria-hidden size={15} />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-micro text-muted mt-2">
              Light is the default — Scrub is a utility you open for a minute, not a suite you sit
              in. The video well stays the darkest thing on screen either way.
            </p>
          </fieldset>

          <hr className="border-line my-4" />

          <div>
            <p className="text-label text-muted mb-2">Running</p>
            {health ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-micro text-muted">ffmpeg</dt>
                <dd className="text-micro text-ink truncate font-mono" title={health.ffmpeg.path}>
                  {shortVersion(health.ffmpeg.version)}
                </dd>
                <dt className="text-micro text-muted">ffprobe</dt>
                <dd className="text-micro text-ink truncate font-mono" title={health.ffprobe.path}>
                  {shortVersion(health.ffprobe.version)}
                </dd>
              </dl>
            ) : (
              <p className="text-micro text-muted">
                Could not reach Scrub&apos;s server. Check the terminal where you ran{' '}
                <code className="font-mono">npm run dev</code>.
              </p>
            )}
          </div>

          <hr className="border-line my-4" />

          <p className="text-micro text-muted">
            Scrub runs on this machine and uses the ffmpeg you installed. Nothing is sent over the
            internet.
          </p>
        </div>
      )}
    </div>
  );
}

/** "ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright…" -> "9.0.1-full_build". */
function shortVersion(full: string): string {
  const match = /version (\S+)/.exec(full);
  const version = match?.[1] ?? full;
  return version.split('-www.')[0] ?? version;
}
