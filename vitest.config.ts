import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ncplanner/ncpf': r('packages/ncpf/src/index.ts'),
      '@ncplanner/kernel': r('packages/kernel/src/index.ts'),
      '@ncplanner/formats': r('packages/formats/src/index.ts'),
      '@ncplanner/i18n': r('packages/i18n/src/index.ts'),
      // Subpath entries must come *before* the bare one: a string alias matches
      // every `find + '/'` prefix, so `@ncplanner/app` alone would rewrite
      // `@ncplanner/app/i18n` to `…/src/index.ts/i18n` (unresolvable) and leave
      // the specifier to Node, which fails — there is no `node_modules` link for
      // a workspace package with no dependencies. These are the subpaths the
      // tests import; they resolve to the same files as the package's own
      // `exports` map, which is what TypeScript resolves them through.
      // The generator's subpaths must precede the bare alias: a string alias matches
      // every `find + '/'` prefix, so the bare entry alone would rewrite
      // `@ncplanner/generator/worker` into `…/src/index.ts/worker`.
      '@ncplanner/generator/worker': r('packages/generator/src/worker.ts'),
      '@ncplanner/generator/script': r('packages/generator/src/script.ts'),
      '@ncplanner/generator': r('packages/generator/src/index.ts'),
      '@ncplanner/app/i18n': r('packages/app/src/i18n.ts'),
      '@ncplanner/app/settings': r('packages/app/src/settings.ts'),
      '@ncplanner/app': r('packages/app/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
});
