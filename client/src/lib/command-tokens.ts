import { OVERWRITE_ARG, TRANSPORT_ARGS } from '@scrub/shared';

export type CommandTokenRole = 'binary' | 'flag' | 'value' | 'path' | 'transport';

export type CommandToken = {
  /** What the bar renders. For a path this is the basename. */
  readonly text: string;
  /** The real argv token. Identical to `text` unless the path was shortened. */
  readonly full: string;
  readonly role: CommandTokenRole;
};

const TRANSPORT: ReadonlySet<string> = new Set<string>([...TRANSPORT_ARGS, OVERWRITE_ARG]);

/** `-c:v`, `-ss`, `-avoid_negative_ts`. A bare negative number is a value, not a flag. */
function isFlag(token: string): boolean {
  return token.startsWith('-') && !/^-?\d/.test(token.slice(1));
}

/**
 * A path, as opposed to a filter that happens to contain a slash.
 *
 * `setpts=PTS/2` was being read as a path and shortened to its "basename", so
 * the bar displayed `-vf 2`. The command bar's whole promise is that what it
 * shows is what runs, and abbreviating a filter into something that means
 * nothing breaks that more thoroughly than a long path ever could.
 *
 * Every ffmpeg filter is `name=value`, and a file path almost never contains an
 * equals sign. Where one does, the cost is that it is shown in full — which is
 * the safe direction to be wrong in.
 */
function isPath(token: string): boolean {
  if (token.includes('=')) return false;
  return /[\\/]/.test(token) || /\.[a-z0-9]{2,5}$/i.test(token);
}

function basename(token: string): string {
  const parts = token.split(/[\\/]/);
  return parts[parts.length - 1] ?? token;
}

/**
 * Classify an argv for the command bar.
 *
 * The array comes straight from `buildArgs` — this only decides what colour each
 * token is drawn in, and whether a path is shown short. Nothing here changes what
 * runs, and `full` always carries the real token so copying stays truthful.
 */
export function tokenizeCommand(
  argv: readonly string[],
  options: { readonly shortenPaths?: boolean } = {},
): readonly CommandToken[] {
  const shorten = options.shortenPaths ?? true;

  // argv from buildArgs starts at the first flag; the binary is what the server
  // spawns, and naming it here is accurate rather than decorative.
  const tokens: CommandToken[] = [{ text: 'ffmpeg', full: 'ffmpeg', role: 'binary' }];

  for (const token of argv) {
    if (TRANSPORT.has(token)) {
      tokens.push({ text: token, full: token, role: 'transport' });
      continue;
    }
    // `pipe:1` is the value of a transport flag and belongs with it.
    const previous = tokens[tokens.length - 1];
    if (previous?.role === 'transport' && previous.full === '-progress') {
      tokens.push({ text: token, full: token, role: 'transport' });
      continue;
    }
    if (isFlag(token)) {
      tokens.push({ text: token, full: token, role: 'flag' });
      continue;
    }
    if (isPath(token)) {
      tokens.push({ text: shorten ? basename(token) : token, full: token, role: 'path' });
      continue;
    }
    tokens.push({ text: token, full: token, role: 'value' });
  }

  return tokens;
}

/** The command exactly as it would be typed. What the copy button puts on the clipboard. */
export function commandToString(argv: readonly string[]): string {
  return ['ffmpeg', ...argv].map(quoteIfNeeded).join(' ');
}

function quoteIfNeeded(token: string): string {
  return /[\s"']/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
}
