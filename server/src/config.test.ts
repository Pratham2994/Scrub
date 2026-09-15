import { describe, expect, it } from 'vitest';

/**
 * Settings are read once, at import, so this file sets the environment before
 * loading the module and every case below is really about that one read.
 */
process.env.SCRUB_PORT = '6000';
process.env.SCRUB_TMP_MIN_AGE_MINUTES = '0';
process.env.SCRUB_TMP_TTL_MINUTES = '';
process.env.SCRUB_MAX_UPLOAD_MB = 'not a number';
process.env.SCRUB_TMP_SWEEP_MINUTES = '-5';

const { config } = await import('./config.js');

describe('reading settings from the environment', () => {
  it('takes a value that is given', () => {
    expect(config.port).toBe(6000);
  });

  /**
   * Zero is a value, not an absence. This used to require a positive number, so
   * setting a limit to 0 to switch it off silently fell back to the default
   * instead — which is the worst way for a setting to behave, because it looks
   * applied and is not.
   */
  it('accepts zero rather than treating it as unset', () => {
    expect(config.tmpMinAgeMs).toBe(0);
  });

  it('falls back when the variable is empty', () => {
    expect(config.tmpTtlMs).toBe(6 * 60 * 60_000);
  });

  it('falls back when the variable is not a number', () => {
    expect(config.maxUploadBytes).toBe(4096 * 1024 * 1024);
  });

  it('falls back on a negative, which no limit here can mean', () => {
    expect(config.tmpSweepIntervalMs).toBe(15 * 60_000);
  });
});

describe('what cannot be configured', () => {
  /**
   * CLAUDE.md's third non-negotiable. The command bar is editable, so a bind on
   * anything but loopback hands arbitrary ffmpeg argv to the network. Nothing
   * reads an environment variable to change this, and this test exists so that
   * stays true by accident as well as on purpose.
   */
  it('binds to loopback, with no environment variable that can move it', () => {
    expect(config.host).toBe('127.0.0.1');

    const reachesHost = Object.entries(process.env).some(
      ([name, value]) => name.startsWith('SCRUB_') && value === config.host,
    );
    expect(reachesHost).toBe(false);
  });
});
