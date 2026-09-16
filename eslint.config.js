import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.tmp/**',
      'playwright-report/**',
      'test-results/**',
      // Plain Node scripts outside any TS project; eslint has no project to parse them with.
      'client/scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md: TypeScript strict, no `any`. Not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      // Errors are values on the server boundary; an unawaited promise there is a
      // response that never arrives.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `type` over `interface`, deliberately. Most of these shapes are members of
      // the `Operation` discriminated union, and interfaces have no implicit index
      // signature — which breaks assignability wherever a generic wants
      // `Record<string, unknown>`, zod's schema inference among them.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      // `plan.passes[0]!` under noUncheckedIndexedAccess. In a test an assertion
      // that is wrong fails the test, which is the entire point of the test.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Server and shared: Node, no DOM.
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Client: browser, React.
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // These sit outside every tsconfig's `include`, so type-aware rules have no
  // program to consult. Linted, just not with type information.
  {
    files: ['client/vite.config.ts', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // Last, so it can turn off everything stylistic that Prettier owns.
  prettier,
);
