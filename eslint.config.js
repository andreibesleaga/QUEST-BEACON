// BEACON — ESLint flat config (E0·T-004). TS + complexity gate + hexagonal boundary rule.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules', '.next', 'dist', 'coverage', 'drizzle', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      complexity: ['error', 10],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': 'off',
    },
  },
  {
    // Domain purity (Article II / F9): the domain layer imports nothing framework/IO-specific.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['next', 'next/*', 'react', 'postgres', 'drizzle-orm', '@/adapters/*', '@/main/*'],
              message: 'Domain layer must not import frameworks, IO, adapters, or the composition root (F9).' },
          ],
        },
      ],
    },
  },
  {
    // CommonJS config/tooling files (e.g. .dependency-cruiser.cjs): give them Node globals + the
    // `commonjs` sourceType so `module`/`require`/`__dirname` are defined (fixes no-undef; src/app rules unchanged).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // ESM Node tooling (scripts/migrate.mjs — the production migrator that runs inside the runtime
    // image): Node globals for `process`/`console`; module sourceType is the flat-config default.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Application layer imports ports, never adapters/infra.
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/adapters/*', '@/main/*', 'next', 'postgres', 'drizzle-orm'],
          message: 'Application use-cases import ports only, never adapters/infra.' }] },
      ],
    },
  },
);
