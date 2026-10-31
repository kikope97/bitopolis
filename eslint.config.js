import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Fronteras entre paquetes (sección 3 de la spec). */
const SIM_FORBIDDEN_GLOBALS = [
  'window', 'document', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage',
  'sessionStorage', 'indexedDB', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame',
  'process', 'require', 'Buffer',
].map((name) => ({ name, message: 'sim es puro: sin DOM, red, temporizadores ni Node.' }));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**', '.probe/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs}', 'packages/server/**', 'packages/sim/cli/**', 'scripts/**', 'e2e/**', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/src/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@bitopolis/server', 'node:*'], message: 'El cliente no importa el servidor ni Node.' }] }],
    },
  },
  {
    files: ['packages/sim/src/**', 'packages/shared/src/**'],
    rules: {
      'no-restricted-globals': ['error', ...SIM_FORBIDDEN_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Usa el PRNG con semilla (prng.ts).' },
        { object: 'Date', property: 'now', message: 'El tiempo de la simulación es state.tick.' },
        { object: 'crypto', property: 'getRandomValues', message: 'Usa el PRNG con semilla.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Prohibido new Date() en sim.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'http', 'https', 'net', 'os', 'child_process'], message: 'sim/shared no usan Node.' },
            { group: ['@bitopolis/client', '@bitopolis/server'], message: 'sim/shared no dependen de client ni server.' },
          ],
        },
      ],
    },
  },
);
