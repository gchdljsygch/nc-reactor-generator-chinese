/**
 * Browser shims for the Node builtins that the *non-UI* packages import.
 *
 * `@ncplanner/formats` reads files with `node:fs` and hashes with
 * `node:crypto`, `@ncplanner/ncpf` reads configuration files with `node:fs`.
 * Those imports exist for the CLI/test path; in the browser the app passes text
 * it already has (a dropped file, a `fetch`ed configuration), so the functions
 * are never called. Vite still has to *resolve* the specifiers, and a browser
 * build cannot resolve `node:*` — hence this module, aliased in
 * `vite.config.ts`.
 *
 * Every export throws: if a future code path does reach one of these from the
 * browser, the failure is loud and immediate instead of a `undefined is not a
 * function` three frames away.
 */

function unavailable(name: string): never {
  throw new Error(`${name} is not available in the browser build (see packages/app/src/shims/node.ts)`);
}

export function readFileSync(): never {
  return unavailable('readFileSync');
}

export function writeFileSync(): never {
  return unavailable('writeFileSync');
}

export function existsSync(): boolean {
  return false;
}

export function readdirSync(): never {
  return unavailable('readdirSync');
}

export function statSync(): never {
  return unavailable('statSync');
}

export function createHash(): never {
  return unavailable('createHash');
}

export function gunzipSync(): never {
  return unavailable('gunzipSync');
}

export function fileURLToPath(): never {
  return unavailable('fileURLToPath');
}

export function join(...parts: string[]): string {
  return parts.join('/');
}

export function resolve(...parts: string[]): string {
  return parts.join('/');
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '.' : path.slice(0, index);
}

export default {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  createHash,
  gunzipSync,
  fileURLToPath,
  join,
  resolve,
  dirname,
};
