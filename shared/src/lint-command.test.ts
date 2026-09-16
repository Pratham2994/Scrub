import { describe, expect, it } from 'vitest';

import { lintCommand, type LintContext } from './lint-command.js';
import { formatCommandLine, parseCommandLine } from './parse-command.js';

const context: LintContext = {
  inputPath: '/work/.tmp/holiday-8f3a4c19.mp4',
  workDir: '/work/.tmp',
};

/** Lint a command the way the bar does: parse the text, then check the argv. */
function lint(line: string) {
  const parsed = parseCommandLine(line);
  if (!parsed.ok) throw new Error(parsed.error);
  return lintCommand(parsed.argv, context);
}

const messages = (line: string): string[] => lint(line).map((d) => `${d.severity}: ${d.message}`);
const has = (line: string, fragment: string): boolean =>
  lint(line).some((d) => d.message.includes(fragment));

describe('parseCommandLine', () => {
  it('splits on whitespace', () => {
    expect(parseCommandLine('ffmpeg -i in.mp4 out.mp4')).toEqual({
      ok: true,
      argv: ['ffmpeg', '-i', 'in.mp4', 'out.mp4'],
    });
  });

  it('keeps quoted paths with spaces as one argument', () => {
    const result = parseCommandLine('ffmpeg -i "my holiday clip.mp4" out.mp4');
    expect(result.ok && result.argv[2]).toBe('my holiday clip.mp4');
  });

  it('keeps a Windows path intact', () => {
    const result = parseCommandLine(String.raw`ffmpeg -i "D:\Code\Scrub\.tmp\a.mp4" out.mp4`);
    expect(result.ok && result.argv[2]).toBe(String.raw`D:\Code\Scrub\.tmp\a.mp4`);
  });

  it('treats a filtergraph with commas and semicolons as one token', () => {
    const result = parseCommandLine('ffmpeg -i a.mp4 -vf "fps=12,scale=480:-2" out.gif');
    expect(result.ok && result.argv[4]).toBe('fps=12,scale=480:-2');
  });

  // The parser is not a shell, and this is the test that says so.
  it('does not expand shell syntax', () => {
    const result = parseCommandLine('ffmpeg -i $HOME/*.mp4 out.mp4');
    expect(result.ok && result.argv[2]).toBe('$HOME/*.mp4');
  });

  it('reports an unclosed quote rather than guessing', () => {
    expect(parseCommandLine('ffmpeg -i "unfinished.mp4')).toMatchObject({
      ok: false,
      column: 10,
    });
  });

  it('round-trips through formatCommandLine', () => {
    const argv = ['ffmpeg', '-i', 'my clip.mp4', '-vf', 'fps=12,scale=480:-2', 'out.gif'];
    const reparsed = parseCommandLine(formatCommandLine(argv));
    expect(reparsed.ok && reparsed.argv).toEqual(argv);
  });
});

describe('lintCommand - structure', () => {
  it('accepts the command Scrub itself generates', () => {
    const clean = lint(
      'ffmpeg -hide_banner -nostdin -nostats -progress pipe:1 -ss 0 -i /work/.tmp/holiday-8f3a4c19.mp4 -t 6 -c copy -avoid_negative_ts make_zero -y /work/.tmp/out.mp4',
    );
    expect(clean).toEqual([]);
  });

  it('requires the command to start with ffmpeg', () => {
    expect(has('ffmpg -i a.mp4 out.mp4', 'starts with "ffmpeg"')).toBe(true);
  });

  it('requires an input', () => {
    expect(has('ffmpeg -y out.mp4', 'needs "-i"')).toBe(true);
  });

  it('requires an output', () => {
    expect(has('ffmpeg -i a.mp4 -y', 'No output file')).toBe(true);
  });

  it('catches a flag with no value', () => {
    expect(has('ffmpeg -i a.mp4 -crf -y out.mp4', '"-crf" needs a value')).toBe(true);
  });

  it('suggests the flag the user probably meant', () => {
    const found = lint('ffmpeg -i a.mp4 -crg 23 out.mp4').find((d) => d.fix === '-crf');
    expect(found?.message).toContain('Did you mean "-crf"?');
  });

  it('does not invent a suggestion for something unrecognisable', () => {
    const found = lint('ffmpeg -i a.mp4 -zzzzzzzz 1 out.mp4').find((d) => d.fix === null);
    expect(found?.message).toContain('Scrub does not recognise "-zzzzzzzz"');
  });

  /**
   * docs/CLAUDE.md's closed operation list is only acceptable because anything else
   * goes through the command bar. A bar that refuses every flag outside Scrub's
   * few dozen is not that: ffmpeg has hundreds, and `-stream_loop` below is a
   * real one Scrub used to withhold Run for.
   */
  it('lets a flag it has never heard of run anyway', () => {
    const found = lint('ffmpeg -stream_loop 4 -i a.mp4 -y out.mp4').find((d) =>
      d.message.includes('-stream_loop'),
    );
    expect(found?.severity).toBe('warning');
    expect(found?.message).toContain('passed to ffmpeg as written');
  });

  /** A near miss is a typo, not an option, and still stops the run. */
  it('still blocks a flag that is one edit away from a real one', () => {
    const found = lint('ffmpeg -i a.mp4 -crg 23 -y out.mp4').find((d) => d.fix === '-crf');
    expect(found?.severity).toBe('error');
  });

  it('does not let an unknown flag break the rest of the parse', () => {
    const diagnostics = lint('ffmpeg -stream_loop 4 -i a.mp4 -c:v libx264 -y out.mp4');
    // The value after the unknown flag must not be mistaken for a missing output.
    expect(diagnostics.some((d) => d.message.includes('No output'))).toBe(false);
    expect(diagnostics.some((d) => d.message.includes('No input'))).toBe(false);
  });

  it('reads a negative number as a value, not a flag', () => {
    expect(has('ffmpeg -i a.mp4 -af loudnorm=I=-16 -y out.mp4', 'not recognise')).toBe(false);
  });
});

describe('lintCommand - the traps from OPERATIONS.md', () => {
  it('rejects filtering while stream-copying', () => {
    expect(
      has('ffmpeg -i a.mp4 -vf scale=640:-2 -c copy -y out.mp4', 'cannot run with "copy"'),
    ).toBe(true);
  });

  it('flags -1 in scale and offers -2', () => {
    const found = lint('ffmpeg -i a.mp4 -vf scale=640:-1 -y out.mp4').find((d) =>
      d.message.includes('Use -2'),
    );
    expect(found?.fix).toBe('scale=640:-2');
  });

  it('leaves a correct -2 scale alone', () => {
    expect(has('ffmpeg -i a.mp4 -vf scale=640:-2 -y out.mp4', 'Use -2')).toBe(false);
  });

  it('rejects a CRF outside 0..51', () => {
    expect(has('ffmpeg -i a.mp4 -crf 90 -y out.mp4', 'between 0 and 51')).toBe(true);
    expect(has('ffmpeg -i a.mp4 -crf 23 -y out.mp4', 'between 0 and 51')).toBe(false);
  });

  it('flags a preset that is not one', () => {
    expect(has('ffmpeg -i a.mp4 -preset turbo -y out.mp4', 'not an x264 preset')).toBe(true);
  });

  it('warns about -to paired with an input-side -ss', () => {
    expect(has('ffmpeg -ss 5 -i a.mp4 -to 10 -c copy -y out.mp4', 'people get wrong')).toBe(true);
  });

  it('explains -ss after -i rather than forbidding it', () => {
    const found = lint('ffmpeg -i a.mp4 -ss 5 -t 3 -y out.mp4').find((d) =>
      d.message.includes('frame-accurate'),
    );
    expect(found?.severity).toBe('info');
  });

  it('warns about a single-pass GIF', () => {
    expect(has('ffmpeg -i a.mp4 -vf fps=12 -y out.gif', '216-colour palette')).toBe(true);
  });

  it('accepts a two-pass GIF', () => {
    expect(
      has(
        'ffmpeg -i a.mp4 -i p.png -lavfi "fps=12,scale=480:-2[x];[x][1:v]paletteuse" -y out.gif',
        '216-colour palette',
      ),
    ).toBe(false);
  });
});

describe('lintCommand - leaving the workspace', () => {
  it('warns when the input is not the loaded file', () => {
    const found = lint('ffmpeg -i /etc/passwd -y out.mp4').find((d) =>
      d.message.includes('not the file Scrub has loaded'),
    );
    expect(found?.fix).toBe(context.inputPath);
  });

  it('warns when the output leaves the working directory', () => {
    expect(
      has(`ffmpeg -i ${context.inputPath} -y /somewhere/else.mp4`, "outside Scrub's working"),
    ).toBe(true);
  });

  it('treats a bare filename as inside the working directory', () => {
    expect(has(`ffmpeg -i ${context.inputPath} -y out.mp4`, "outside Scrub's working")).toBe(false);
  });
});

describe('lintCommand - severity ordering', () => {
  it('reports a broken command as errors, not suggestions', () => {
    expect(messages('ffmpeg -vf scale=640:-1')).toEqual(
      expect.arrayContaining([expect.stringMatching(/^error: No input/)]),
    );
  });
});
