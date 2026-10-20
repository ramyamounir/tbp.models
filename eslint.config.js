import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

const NO_HTML = 'Use textContent (see spec: file-derived strings).';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/no-danger': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: NO_HTML },
        { property: 'outerHTML', message: NO_HTML },
        { property: 'insertAdjacentHTML', message: NO_HTML },
        { object: 'document', property: 'write', message: 'Not allowed.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: NO_HTML,
        },
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: NO_HTML,
        },
        {
          selector: "MemberExpression[property.name='insertAdjacentHTML']",
          message: NO_HTML,
        },
        {
          selector: "MemberExpression[object.name='document'][property.name=/^(write|writeln)$/]",
          message: 'Not allowed.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: NO_HTML,
        },
      ],
    },
  },
]);
