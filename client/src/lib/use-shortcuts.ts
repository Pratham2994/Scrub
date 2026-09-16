import { useEffect } from 'react';

import { currentTime, seekTo, togglePlay } from '@/lib/playback';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * True when the keystroke belongs to whatever the user is typing in.
 *
 * This is why the global `Space` handler does not start an encode: the Run
 * button is focusable and `Space` is its native activation key, so a shortcut
 * that ignored focus would play the video *and* press whatever button happened
 * to be focused. The same applies to the command editor and the timecode fields.
 */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Any button or slider: Space and the arrows are already its own.
  return target.closest('button,[role="slider"]') !== null;
}

/**
 * Every shortcut is registered in the capture phase, which is load-bearing.
 *
 * Clicking the picture focuses the `<video controls>` element, and from then on
 * the browser's own controls also answer Space and the arrows. Listening on the
 * bubble phase meant both fired: Space toggled twice and left the video exactly
 * where it was, and an arrow moved the native seek step *plus* a frame.
 *
 * Deferring to the native controls instead was worse - it made the keys behave
 * differently depending on where the user last clicked. Capturing first and
 * calling `preventDefault` means Scrub's shortcuts win everywhere and a frame
 * step is a frame step regardless of focus.
 */
const CAPTURE = true;

/**
 * The keyboard surface from DESIGN.md's quality floor.
 *
 * Landing on an exact frame with a mouse is the task Scrub exists to make less
 * painful, and for some users the keyboard is the only precise way to do it -
 * so these are a primary interface here, not a convenience layer.
 */
export function useShortcuts(): void {
  const meta = useScrubStore((state) => state.meta);
  const trim = useScrubStore((state) => state.trim);
  const setTrim = useScrubStore((state) => state.setTrim);

  useEffect(() => {
    if (meta === null) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target)) return;

      // A frame, when the source reports a rate. Falling back to 1/30 is better
      // than refusing to nudge at all on a file with no frame rate.
      const frame = 1 / (meta.video?.fps ?? 30);
      const at = currentTime();
      const minGap = Math.min(0.1, meta.durationSec / 100);

      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          return;
        case '[':
          // Set the in point where the playhead is, which is the whole reason
          // for scrubbing to a frame in the first place.
          event.preventDefault();
          setTrim({ startSec: Math.min(at, trim.endSec - minGap) });
          return;
        case ']':
          event.preventDefault();
          setTrim({ endSec: Math.max(at, trim.startSec + minGap) });
          return;
        case 'ArrowLeft':
          event.preventDefault();
          seekTo(at - (event.shiftKey ? 1 : frame));
          return;
        case 'ArrowRight':
          event.preventDefault();
          seekTo(at + (event.shiftKey ? 1 : frame));
          return;
        case 'Home':
          event.preventDefault();
          seekTo(0);
          return;
        case 'End':
          event.preventDefault();
          seekTo(meta.durationSec);
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown, CAPTURE);
    return () => {
      window.removeEventListener('keydown', onKeyDown, CAPTURE);
    };
  }, [meta, trim, setTrim]);
}
