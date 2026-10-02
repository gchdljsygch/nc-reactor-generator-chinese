#!/usr/bin/env node
/**
 * R2.11 — `settings.dat` (`config2`) → `settings.json` (the rewrite's settings
 * document) one-shot migration.
 *
 * Usage:
 *
 *   node --experimental-transform-types tools/ts/migrate-settings.mjs [inFile] [outFile] [--language=zh_CN]
 *
 *   inFile    legacy `settings.dat`      (default: ./settings.dat)
 *   outFile   new JSON document to write (default: ./settings.json)
 *   --language=<tag>  locale the new app should start in (default: en_US, the
 *                     canonical locale; the legacy file has no language key)
 *   --dry-run         decode + migrate and print the JSON to stdout, write nothing
 *
 * The decoding/migration logic itself lives in
 * `packages/formats/src/legacy/settings.ts` and is covered by
 * `packages/formats/test/r2.11-settings.test.ts`; this file only does I/O, so
 * there is exactly one implementation of the mapping (it deliberately
 * re-implements nothing).
 *
 * Why the flags are needed (measured on this machine, Node 24.16.0):
 *
 *   - a plain `node tools/ts/migrate-settings.mjs` cannot load the TypeScript
 *     sources: ESM specifiers inside them carry the `.js` extension that
 *     `tsc --moduleResolution bundler` requires, and Node's type stripping does
 *     not rewrite `.js` → `.ts`. {@link tsSpecifierHook} installs a `node:module`
 *     resolve hook that does exactly that rewrite for relative specifiers;
 *   - `--experimental-strip-types` alone still fails, because
 *     `packages/formats/src/config2.ts` uses a `const enum` (strip-only mode
 *     rejects enums with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`);
 *     `--experimental-transform-types` handles it. Running without the flag
 *     prints that exact command instead of a stack trace.
 *
 * Exit codes: 0 migrated (or dry run), 1 usage/IO/decoding failure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const USAGE = `usage: node --experimental-transform-types tools/ts/migrate-settings.mjs [inFile] [outFile] [--language=xx_YY] [--dry-run]`;

/**
 * Make the `.js` specifiers inside the TypeScript sources resolve to the `.ts`
 * file next to them (what `tsc --moduleResolution bundler` requires, but what
 * Node's type stripping does not do). Only relative specifiers coming from a
 * TypeScript file are rewritten, so nothing else in the graph is touched.
 */
function tsSpecifierHook() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        specifier.endsWith('.js') &&
        typeof context.parentURL === 'string' &&
        context.parentURL.endsWith('.ts')
      ) {
        const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

function parseArgs(argv) {
  const positional = [];
  let language;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--language=')) language = arg.slice('--language='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`unknown option: ${arg}\n${USAGE}`);
      process.exit(1);
    } else positional.push(arg);
  }
  return {
    inFile: positional[0] ?? 'settings.dat',
    outFile: positional[1] ?? 'settings.json',
    language,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.inFile)) {
    console.error(`migrate-settings: ${args.inFile} does not exist`);
    process.exit(1);
  }

  tsSpecifierHook();
  let settings;
  try {
    settings = await import('../../packages/formats/src/legacy/settings.ts');
  } catch (error) {
    if (error && error.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      console.error(
        'migrate-settings: this script must run with type transformation enabled ' +
          '(packages/formats/src/config2.ts uses a `const enum`):\n' +
          '  node --experimental-transform-types tools/ts/migrate-settings.mjs ' +
          `${args.inFile} ${args.outFile}`,
      );
      process.exit(1);
    }
    throw error;
  }

  const migration = settings.migrateSettingsFile(args.inFile, { language: args.language });
  const json = settings.serializeAppSettings(migration.settings);

  for (const issue of migration.issues) console.error(`note: ${issue}`);
  if (args.dryRun) {
    process.stdout.write(json);
    return;
  }
  writeFileSync(args.outFile, json);
  console.error(
    `migrated ${args.inFile} -> ${args.outFile} ` +
      `(language ${migration.settings.language}, ${migration.issues.length} notes)`,
  );
}

main().catch((error) => {
  console.error(`migrate-settings: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
