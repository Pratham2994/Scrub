/**
 * Turns an edited command string back into an argv array.
 *
 * This is deliberately **not** a shell. It understands quoting and nothing else:
 * no globbing, no `$VAR`, no `~`, no backticks, no `$(…)`, no pipes, no `;` or
 * `&&`. Those characters are ordinary text here.
 *
 * That restraint is the security boundary. Scrub spawns an argument array with
 * `shell: false`, so a parser that quietly supported shell metacharacters would
 * either lie about what runs, or become the shell Scrub refuses to use.
 */

export type ParsedCommand =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly column: number };

export function parseCommandLine(input: string): ParsedCommand {
  const argv: string[] = [];
  let current = '';
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;
  let quoteStart = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '';

    if (quote === "'") {
      // Single quotes are literal all the way through, backslashes included.
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '\\') {
        const next = input[i + 1];
        // Only these two are escapes inside double quotes; everything else keeps
        // its backslash, so Windows paths survive being typed normally.
        if (next === '"' || next === '\\') {
          current += next;
          i += 1;
        } else {
          current += char;
        }
        continue;
      }
      if (char === '"') quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteStart = i;
      // An empty pair of quotes is still an argument.
      hasCurrent = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasCurrent) {
        argv.push(current);
        current = '';
        hasCurrent = false;
      }
      continue;
    }

    current += char;
    hasCurrent = true;
  }

  if (quote !== null) {
    return {
      ok: false,
      error: `Unclosed ${quote === '"' ? 'double' : 'single'} quote.`,
      column: quoteStart,
    };
  }

  if (hasCurrent) argv.push(current);

  return { ok: true, argv };
}

/** The inverse: an argv rendered as a line the user can edit and re-parse. */
export function formatCommandLine(argv: readonly string[]): string {
  return argv.map(quoteToken).join(' ');
}

function quoteToken(token: string): string {
  if (token === '') return '""';
  if (!/[\s"']/.test(token)) return token;
  return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
