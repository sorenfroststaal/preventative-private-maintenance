import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/target/**'] },
  ...tseslint.configs.recommended,
];
