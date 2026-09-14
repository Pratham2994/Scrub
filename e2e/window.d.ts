/**
 * Bridges from the page back into the test process. Playwright's
 * `exposeFunction` installs these on `window`, which TypeScript has no way to
 * know about from inside a `page.evaluate` callback.
 */
declare global {
  interface Window {
    readonly __clip: (value: string) => Promise<void>;
    readonly __frame: (value: string) => Promise<void>;
  }
}

export {};
