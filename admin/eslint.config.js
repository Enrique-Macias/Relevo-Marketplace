import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/db/admin.types.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: 'Prohibido en el panel: todo texto de usuario se pinta escapado (rf17-plan-admin.md §2).',
      }, {
        selector: "JSXAttribute[name.name='style']",
        message: 'Sin estilos inline: la CSP de producción no permite style-src inline. Usa una clase de estilos.css.',
      }],
    },
  },
);
