/**
 * What the pre-commit hook runs, on staged files only (lint-staged passes them as arguments), so
 * it stays at a few seconds however large the repo gets. `pnpm lint` still checks everything.
 *
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': [
    'eslint --fix --max-warnings 0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,css,html,yml,yaml}': 'prettier --write --ignore-unknown',
};
