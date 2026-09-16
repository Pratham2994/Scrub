import { useCallback, useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'scrub:theme';

export function isTheme(value: string): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored !== null && isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applied by setting (or removing) `data-theme` on the document element.
 *
 * "system" removes the attribute rather than resolving it to a value, so the
 * `prefers-color-scheme` media query in the stylesheet stays in charge and the
 * page follows the OS live - including when the user changes it while Scrub is
 * open, with no listener needed here.
 */
function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Persisted in localStorage rather than sessionStorage: the loaded file belongs
 * to one tab, but a theme preference is about the person.
 */
export function useTheme(): { readonly theme: Theme; readonly setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage can be refused. The choice still applies for this session.
    }
  }, []);

  return { theme, setTheme };
}

/**
 * Applied before React mounts, from index.html, so a dark-mode user never gets a
 * flash of the light palette while the bundle loads.
 */
export function applyStoredThemeEarly(): void {
  apply(read());
}
