import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * `config` reads the environment once, at import. Several of these files set
     * SCRUB_TMP_DIR and friends before importing the module under test, so they
     * must not share a module registry with each other.
     */
    isolate: true,
    pool: 'forks',
  },
});
