import { fileURLToPath } from 'node:url';

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * R3.1 — the app's Vite configuration.
 *
 * Two things are load-bearing:
 *
 *  - the workspace packages are aliased to their **source** entry points, so the
 *    app builds from the same files CI typechecks (no build order, no `dist/`);
 *  - the Node builtins the non-UI packages import are aliased to
 *    `src/shims/node.ts` — see that file for why, and note that the shims throw,
 *    so a browser code path that really needs `fs` fails loudly.
 *
 * The object is exported **without** importing `vite`'s `defineConfig`: `vite` is
 * not a declared dependency (it arrives transitively through `vitest`), so under
 * pnpm's strict layout there is no `node_modules/vite` for the config file itself
 * to resolve — only the `.bin/vite` shim. `defineConfig` is a type-only identity
 * helper, so dropping it changes nothing at runtime and keeps
 * `pnpm install --frozen-lockfile` valid.
 */
export default {
  root: r('.'),
  resolve: {
    alias: {
      '@ncplanner/ncpf': r('../ncpf/src/index.ts'),
      '@ncplanner/kernel': r('../kernel/src/index.ts'),
      '@ncplanner/formats': r('../formats/src/index.ts'),
      '@ncplanner/i18n': r('../i18n/src/index.ts'),
      '@ncplanner/generator/worker': r('../generator/src/worker.ts'),
      '@ncplanner/generator/script': r('../generator/src/script.ts'),
      '@ncplanner/generator': r('../generator/src/index.ts'),
      'node:fs': r('./src/shims/node.ts'),
      'node:crypto': r('./src/shims/node.ts'),
      'node:zlib': r('./src/shims/node.ts'),
      'node:path': r('./src/shims/node.ts'),
      'node:url': r('./src/shims/node.ts'),
      fs: r('./src/shims/node.ts'),
      crypto: r('./src/shims/node.ts'),
      zlib: r('./src/shims/node.ts'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The shipped configuration is ~1.2 MB of JSON; inlining it as a parsed
    // module is what keeps "open the app" a single request (R3.1 shell).
    chunkSizeWarningLimit: 4096,
  },
};
