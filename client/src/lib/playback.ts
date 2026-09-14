/**
 * The bridge between the video element and the timeline under it.
 *
 * Deliberately not React state. A playhead has to move at the frame rate to
 * look attached to the picture, and pushing sixty updates a second through the
 * store would re-render the workspace sixty times a second to move one line.
 * Subscribers get the time and write it straight to a DOM node instead.
 *
 * `timeupdate` is not enough on its own — browsers fire it about four times a
 * second, which is visibly steppy — so this drives an animation frame loop while
 * something is actually listening and the video is actually playing.
 */

type Listener = (seconds: number) => void;

let element: HTMLVideoElement | null = null;
const listeners = new Set<Listener>();
let frame = 0;

function emit(): void {
  if (element === null) return;
  const seconds = element.currentTime;
  for (const listener of listeners) listener(seconds);
}

function tick(): void {
  emit();
  frame = requestAnimationFrame(tick);
}

function start(): void {
  if (frame !== 0 || listeners.size === 0 || element === null) return;
  frame = requestAnimationFrame(tick);
}

function stop(): void {
  if (frame === 0) return;
  cancelAnimationFrame(frame);
  frame = 0;
  // One last read, so the playhead lands on the paused position rather than
  // wherever the final frame happened to catch it.
  emit();
}

/** Called by the media element as it mounts and unmounts. */
export function registerVideo(next: HTMLVideoElement | null): void {
  if (element !== null) {
    element.removeEventListener('play', start);
    element.removeEventListener('pause', stop);
    element.removeEventListener('ended', stop);
    element.removeEventListener('seeked', emit);
    element.removeEventListener('loadedmetadata', emit);
  }
  stop();
  element = next;
  if (element === null) return;

  element.addEventListener('play', start);
  element.addEventListener('pause', stop);
  element.addEventListener('ended', stop);
  // Seeking and loading move the playhead without the loop running.
  element.addEventListener('seeked', emit);
  element.addEventListener('loadedmetadata', emit);
  emit();
  if (!element.paused) start();
}

export function seekTo(seconds: number): void {
  if (element === null) return;
  element.currentTime = Math.max(0, seconds);
}

export function currentTime(): number {
  return element?.currentTime ?? 0;
}

export function togglePlay(): void {
  if (element === null) return;
  if (element.paused) void element.play();
  else element.pause();
}

export function isPlaying(): boolean {
  return element !== null && !element.paused;
}

export function subscribeTime(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentTime());
  if (isPlaying()) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
