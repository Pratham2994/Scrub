import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type FfmpegTool = {
  readonly name: 'ffmpeg' | 'ffprobe';
  /**
   * Absolute path to the executable, resolved once at boot.
   *
   * Scrub spawns this, not the bare name. Two reasons: PATH can change under a
   * long-running process, and on Windows Node refuses to spawn a `.bat`/`.cmd`
   * without `shell: true` (the CVE-2024-27980 hardening) — which we will not do.
   * Resolving here means a shim-installed ffmpeg fails at boot with a readable
   * message instead of at Run with a bare EINVAL.
   */
  readonly path: string;
  /** First line of `-version`, e.g. "ffmpeg version 9.0.1-full_build-www.gyan.dev". */
  readonly version: string;
};

export type FfmpegTools = {
  readonly ffmpeg: FfmpegTool;
  readonly ffprobe: FfmpegTool;
};

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.com'];

/**
 * PATH lookup without a dependency. Deliberately does not consider `.bat`/`.cmd`:
 * Node cannot spawn those without a shell, so finding one would be worse than not
 * finding it — we would report success and then fail at Run.
 */
function resolveOnPath(binary: string): string | null {
  const override = process.env[`SCRUB_${binary.toUpperCase()}_PATH`];
  if (override !== undefined && override !== '' && isExecutableFile(override)) {
    return path.resolve(override);
  }

  const rawPath = process.env.PATH ?? '';
  const entries = rawPath.split(path.delimiter).filter((entry) => entry !== '');
  const candidates =
    process.platform === 'win32'
      ? WINDOWS_EXECUTABLE_EXTENSIONS.map((ext) => `${binary}${ext}`)
      : [binary];

  for (const dir of entries) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isExecutableFile(full)) return full;
    }
  }
  return null;
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stats = fs.statSync(candidate);
    if (!stats.isFile()) return false;
    // X_OK is meaningless on Windows; existence as a file is the real test there.
    if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function probeVersion(binaryPath: string): string | null {
  const result = spawnSync(binaryPath, ['-version'], {
    encoding: 'utf8',
    // No shell. Ever. CLAUDE.md non-negotiable #2 applies to the health check too.
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return null;
  const firstLine = result.stdout.split('\n', 1)[0]?.trim();
  return firstLine !== undefined && firstLine !== '' ? firstLine : null;
}

function locate(name: 'ffmpeg' | 'ffprobe'): FfmpegTool | null {
  const resolved = resolveOnPath(name);
  if (resolved === null) return null;
  const version = probeVersion(resolved);
  if (version === null) return null;
  return { name, path: resolved, version };
}

export function installInstructions(): string {
  switch (process.platform) {
    case 'win32':
      return [
        '  winget install Gyan.FFmpeg',
        '  # or: choco install ffmpeg-full',
        '  # or: scoop install ffmpeg',
        '',
        '  Then open a new terminal so PATH is picked up.',
      ].join('\n');
    case 'darwin':
      return ['  brew install ffmpeg', '  # or: port install ffmpeg'].join('\n');
    default:
      return [
        '  sudo apt install ffmpeg        # Debian, Ubuntu',
        '  sudo dnf install ffmpeg        # Fedora',
        '  sudo pacman -S ffmpeg          # Arch',
      ].join('\n');
  }
}

/**
 * Boot gate. Scrub refuses to start without both binaries, because "nothing happens
 * when I press Run" is a miserable thing to debug an hour later — far worse than a
 * refusal at startup that says exactly what is missing and how to get it.
 */
export function requireFfmpeg(): FfmpegTools {
  const ffmpeg = locate('ffmpeg');
  const ffprobe = locate('ffprobe');

  if (ffmpeg !== null && ffprobe !== null) {
    return { ffmpeg, ffprobe };
  }

  const missing = [ffmpeg === null ? 'ffmpeg' : null, ffprobe === null ? 'ffprobe' : null]
    .filter((name): name is string => name !== null)
    .join(' and ');

  process.stderr.write(
    [
      '',
      `Scrub cannot start: ${missing} was not found on PATH, or would not run.`,
      '',
      'Scrub is a front-end for ffmpeg. It does not bundle one, so you need it installed:',
      '',
      installInstructions(),
      '',
      'Already installed? Point Scrub at it directly:',
      '',
      '  SCRUB_FFMPEG_PATH=/full/path/to/ffmpeg',
      '  SCRUB_FFPROBE_PATH=/full/path/to/ffprobe',
      '',
      'Note that a .bat or .cmd wrapper will not work — Scrub spawns the executable',
      'without a shell on purpose, so it needs the real binary.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
