/**
 * Thrown by `buildArgs` for operations that are declared in the `Operation` union
 * but whose argv is not written yet. It is a distinct class so callers can tell
 * "this operation does not exist yet" apart from "this operation was given bad
 * parameters" — the first is a gap in Scrub, the second is the user's input.
 */
export class NotImplemented extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`buildArgs: "${operation}" is not implemented yet`);
    this.name = 'NotImplemented';
    this.operation = operation;
  }
}

/**
 * Thrown when an operation's parameters cannot produce a runnable command —
 * a trim whose end precedes its start, a resize to zero width. These are
 * programmer/UI errors: the client is expected to keep controls in valid ranges,
 * and the server revalidates with zod before it ever reaches here.
 */
export class InvalidOperation extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`buildArgs: "${operation}" is not runnable — ${reason}`);
    this.name = 'InvalidOperation';
    this.operation = operation;
  }
}
