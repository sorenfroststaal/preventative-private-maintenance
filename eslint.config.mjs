import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/target/**', '**/src-tauri/runtime/**'] },
  ...tseslint.configs.recommended,
];
