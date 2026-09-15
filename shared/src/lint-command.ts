/**
 * Diagnostics for a hand-edited ffmpeg command.
 *
 * The command bar is editable because the operation list is closed — anything
 * Scrub does not offer is done by typing. But ffmpeg's failure modes are mostly
 * silent or cryptic: `-1` in a scale filter fails the encode with a codec error
 * that says nothing about the `-1`, and a single-pass GIF succeeds while looking
 * visibly worse. This turns the traps in docs/OPERATIONS.md into something the
 * user is told *before* pressing Run rather than after.
 *
 * Pure, like buildArgs, so every rule is a snapshot test.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type Diagnostic = {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Index into argv, when the diagnostic is about a specific token. */
  readonly tokenIndex: number | null;
  /** A concrete replacement for that token, when there is an obvious one. */
  readonly fix: string | null;
};

export type LintContext = {
  /** The path Scrub loaded. An input other than this is reading something else. */
  readonly inputPath: string;
  /** Scrub's working directory. Output elsewhere is writing outside the workspace. */
  readonly workDir: string;
};

/** Options ffmpeg takes, and whether each consumes the token after it. */
const FLAG_ARITY: ReadonlyMap<string, 0 | 1> = new Map([
  ['-hide_banner', 0],
  ['-nostdin', 0],
  ['-nostats', 0],
  ['-stats', 0],
  ['-y', 0],
  ['-n', 0],
  ['-copyts', 0],
  ['-start_at_zero', 0],
  ['-shortest', 0],
  ['-vn', 0],
  ['-an', 0],
  ['-sn', 0],
  ['-dn', 0],
  ['-progress', 1],
  ['-loglevel', 1],
  ['-v', 1],
  ['-threads', 1],
  ['-ss', 1],
  ['-to', 1],
  ['-t', 1],
  ['-i', 1],
  ['-f', 1],
  ['-r', 1],
  ['-itsoffset', 1],
  ['-c', 1],
  ['-c:v', 1],
  ['-c:a', 1],
  ['-c:s', 1],
  ['-codec', 1],
  ['-vcodec', 1],
  ['-acodec', 1],
  ['-crf', 1],
  ['-preset', 1],
  ['-tune', 1],
  ['-b:v', 1],
  ['-b:a', 1],
  ['-q:v', 1],
  ['-q:a', 1],
  ['-qscale', 1],
  ['-vf', 1],
  ['-af', 1],
  ['-filter:v', 1],
  ['-filter:a', 1],
  ['-lavfi', 1],
  ['-filter_complex', 1],
  ['-map', 1],
  ['-map_metadata', 1],
  ['-metadata', 1],
  ['-movflags', 1],
  ['-avoid_negative_ts', 1],
  ['-fflags', 1],
  ['-pix_fmt', 1],
  ['-profile:v', 1],
  ['-level', 1],
  ['-g', 1],
  ['-ar', 1],
  ['-ac', 1],
  ['-s', 1],
  ['-aspect', 1],
  ['-frames:v', 1],
  ['-vsync', 1],
  ['-max_muxing_queue_size', 1],
]);

const PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
  'placebo',
]);

/** Levenshtein, capped — only used to suggest a flag the user probably meant. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const current = [i, ...Array.from({ length: cols - 1 }, () => 0)];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

function suggestFlag(unknown: string): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of FLAG_ARITY.keys()) {
    const distance = editDistance(unknown, known);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  // Two edits on a short flag is already a different flag, not a typo.
  return best !== null && bestDistance <= 2 ? best : null;
}

function isFlag(token: string): boolean {
  return token.startsWith('-') && !/^-\d/.test(token);
}

export function lintCommand(argv: readonly string[], context: LintContext): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (
    severity: DiagnosticSeverity,
    message: string,
    tokenIndex: number | null = null,
    fix: string | null = null,
  ): void => {
    out.push({ severity, message, tokenIndex, fix });
  };

  if (argv.length === 0) {
    add('error', 'The command is empty.');
    return out;
  }

  // Scrub always spawns ffmpeg. Renaming the binary would not change what runs,
  // so an unexpected first token is a mistake rather than a choice.
  if (argv[0] !== 'ffmpeg') {
    add('error', `A Scrub command starts with "ffmpeg", not "${argv[0] ?? ''}".`, 0, 'ffmpeg');
  }

  const values = new Map<string, string>();
  const flagIndex = new Map<string, number>();
  let inputIndex = -1;
  const consumed = new Set<number>();

  for (let i = 1; i < argv.length; i += 1) {
    if (consumed.has(i)) continue;
    const token = argv[i] ?? '';
    if (!isFlag(token)) continue;

    const arity = FLAG_ARITY.get(token);
    if (arity === undefined) {
      const suggestion = suggestFlag(token);
      /**
       * A flag Scrub has never heard of does not block the run.
       *
       * ffmpeg has hundreds of options and this list holds a few dozen, so
       * refusing everything outside it would make CLAUDE.md's fourth
       * non-negotiable untrue: the closed operation list is only acceptable
       * because "anything else goes through the editable command bar", and a
       * bar that runs a curated subset of ffmpeg is not that. `-stream_loop`
       * is a real option and Scrub used to withhold Run for it.
       *
       * A near miss is different. `-crg` is one edit away from `-crf` and is a
       * typo rather than an option, so that still stops the run and offers the
       * fix. Where there is nothing close, the flag is probably real, and if it
       * is not then ffmpeg says so in words this audience can read - which is
       * why its stderr is surfaced rather than summarised.
       */
      add(
        suggestion === null ? 'warning' : 'error',
        suggestion === null
          ? `Scrub does not recognise "${token}". It will be passed to ffmpeg as written.`
          : `Scrub does not recognise "${token}". Did you mean "${suggestion}"?`,
        i,
        suggestion,
      );
      continue;
    }

    flagIndex.set(token, i);

    if (arity === 1) {
      const next = argv[i + 1];
      if (next === undefined || isFlag(next)) {
        add('error', `"${token}" needs a value after it.`, i);
        continue;
      }
      values.set(token, next);
      consumed.add(i + 1);
      if (token === '-i') inputIndex = i + 1;
    }
  }

  if (inputIndex === -1) {
    add('error', 'No input: the command needs "-i" followed by a file.');
  }

  // The output is the last token, and it must not be a flag or a flag's value.
  const lastIndex = argv.length - 1;
  const lastToken = argv[lastIndex] ?? '';
  const hasOutput = lastIndex > 0 && !isFlag(lastToken) && !consumed.has(lastIndex);
  if (!hasOutput) {
    add('error', 'No output file at the end of the command.', lastIndex);
  }

  // --- The traps from docs/OPERATIONS.md -----------------------------------

  const filter = values.get('-vf') ?? values.get('-filter:v') ?? values.get('-lavfi') ?? null;
  const audioFilter = values.get('-af') ?? values.get('-filter:a') ?? null;
  const codecAll = values.get('-c') ?? values.get('-codec') ?? null;
  const codecVideo = values.get('-c:v') ?? values.get('-vcodec') ?? null;
  const codecAudio = values.get('-c:a') ?? values.get('-acodec') ?? null;

  if (filter !== null && (codecAll === 'copy' || codecVideo === 'copy')) {
    const index = flagIndex.get('-c') ?? flagIndex.get('-c:v') ?? flagIndex.get('-vcodec') ?? null;
    add(
      'error',
      'A video filter cannot run with "copy" — copying passes packets through without decoding them. Pick an encoder such as libx264.',
      index,
      null,
    );
  }
  if (audioFilter !== null && (codecAll === 'copy' || codecAudio === 'copy')) {
    add(
      'error',
      'An audio filter cannot run with "copy". Pick an encoder such as aac.',
      flagIndex.get('-c:a') ?? flagIndex.get('-c') ?? null,
    );
  }

  if (filter !== null && /scale=[^,\s]*-1(?![0-9])/.test(filter)) {
    const index = flagIndex.get('-vf') ?? flagIndex.get('-filter:v') ?? flagIndex.get('-lavfi');
    add(
      'warning',
      'Use -2 rather than -1 in scale: libx264 needs even dimensions, and -1 can produce an odd number that fails the encode.',
      index !== undefined ? index + 1 : null,
      filter.replace(/(scale=[^,\s]*?)-1(?![0-9])/g, '$1-2'),
    );
  }

  const crf = values.get('-crf');
  if (crf !== undefined) {
    const value = Number.parseInt(crf, 10);
    if (!Number.isFinite(value) || value < 0 || value > 51) {
      add(
        'error',
        'CRF must be between 0 and 51. 18 is near-lossless, 23 default, 28 soft.',
        (flagIndex.get('-crf') ?? 0) + 1,
      );
    }
  }

  const preset = values.get('-preset');
  if (preset !== undefined && !PRESETS.has(preset)) {
    add(
      'warning',
      `"${preset}" is not an x264 preset. They run ultrafast through veryslow, and trade encode time for file size — not quality.`,
      (flagIndex.get('-preset') ?? 0) + 1,
    );
  }

  const ssIndex = flagIndex.get('-ss');
  if (ssIndex !== undefined && inputIndex !== -1) {
    const beforeInput = ssIndex < inputIndex - 1;
    if (beforeInput && values.has('-to')) {
      add(
        'warning',
        '"-to" after an input-side "-ss" is the pairing people get wrong. "-t <duration>" is unambiguous.',
        flagIndex.get('-to') ?? null,
      );
    }
    if (!beforeInput) {
      add(
        'info',
        '"-ss" after "-i" is frame-accurate but decodes and re-encodes. Before "-i" it seeks on keyframes and is much faster.',
        ssIndex,
      );
    }
  }

  if (hasOutput && /\.gif$/i.test(lastToken)) {
    const chain = `${filter ?? ''} ${values.get('-filter_complex') ?? ''}`;
    if (!/palette(gen|use)/.test(chain)) {
      add(
        'warning',
        "A GIF without palettegen/paletteuse falls back to a fixed 216-colour palette and looks visibly worse. Scrub's GIF operation does it in two passes.",
        lastIndex,
      );
    }
  }

  if (inputIndex !== -1) {
    const input = argv[inputIndex] ?? '';
    if (input !== context.inputPath) {
      add(
        'warning',
        'This input is not the file Scrub has loaded, so the preview and duration above no longer describe what will run.',
        inputIndex,
        context.inputPath,
      );
    }
  }

  if (hasOutput && !isInside(lastToken, context.workDir)) {
    add(
      'warning',
      "The output is outside Scrub's working directory. ffmpeg will write there, and Scrub will not be able to offer it as a download.",
      lastIndex,
    );
  }

  if (!flagIndex.has('-progress')) {
    add('info', 'Without "-progress pipe:1" the Run button cannot report progress.');
  }
  if (!flagIndex.has('-y') && !flagIndex.has('-n')) {
    add('info', 'Without "-y" ffmpeg refuses to overwrite an existing output.');
  }

  return out;
}

/** Both sides normalised to forward slashes so Windows paths compare sanely. */
function isInside(candidate: string, directory: string): boolean {
  const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const path = normalise(candidate);
  const dir = normalise(directory);
  // A bare filename has no directory, so it lands in the working directory.
  if (!path.includes('/')) return true;
  return path.toLowerCase().startsWith(`${dir.toLowerCase()}/`);
}
