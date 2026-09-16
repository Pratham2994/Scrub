import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark' | 'phosphor';

const KEY = 'scrub:theme';

export function isTheme(value: string): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'phosphor';
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
 * The one live copy of the choice, shared by every consumer.
 *
 * Before Tube this file could get away with a per-instance `useState`: no
 * component rendered differently by theme, so the only thing that had to
 * update was the attribute, and the instance that ran `setTheme` did that.
 * Tube components branch their classes on the theme, and a per-instance copy
 * meant each of them kept the value from its own mount while the attribute
 * moved on without them - the rail stayed vertical after a switch because it
 * never heard about it.
 *
 * A theme preference is about the person, not about a component, so it lives
 * at module scope behind `useSyncExternalStore`: SettingsPanel sets it, every
 * consumer re-renders, and `apply` runs exactly once per change.
 */
let current: Theme = read();
const listeners = new Set<() => void>();

/**
 * Persisted in localStorage rather than sessionStorage: the loaded file belongs
 * to one tab, but a theme preference is about the person.
 */
export function useTheme(): { readonly theme: Theme; readonly setTheme: (next: Theme) => void } {
  const theme = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );

  const setTheme = useCallback((next: Theme) => {
    current = next;
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage can be refused. The choice still applies for this session.
    }
    listeners.forEach((listener) => {
      listener();
    });
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
