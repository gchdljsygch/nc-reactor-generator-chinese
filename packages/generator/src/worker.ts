/**
 * The Web Worker entry for the generator pool.
 *
 * ## Why this file is its own export
 *
 * `@ncplanner/generator/worker` is a *separate* entry point so that the worker bundle
 * never inherits the app's DOM-facing imports, and so the main-thread bundle never
 * pulls in the worker plumbing. `packages/app/vite.config.ts` aliases the workspace
 * packages to source, so this file is bundled by Vite directly when the app does
 * `new Worker(new URL('@ncplanner/generator/worker', import.meta.url), { type: 'module' })`.
 *
 * ## Why the first worker we ship is a *task* worker, not a "run N iterations" one
 *
 * The worker receives a whole generator document plus a seed and an iteration budget,
 * runs {@link runGenerator} and posts back the portable cell list of its best grid.
 * That is coarse-grained on purpose:
 *
 *  - a message per iteration would dominate the actual work;
 *  - a shared-memory pool would need `SharedArrayBuffer` and cross-origin isolation
 *    headers, which a static Pages deployment cannot set;
 *  - coarse tasks make the pool's result *independent of scheduling* for a fixed
 *    (seed, iterations) pair, which is what makes the search testable.
 *
 * The file is written so that it is **inert when imported outside a worker**: it only
 * attaches a listener when `self` actually looks like a `WorkerGlobalScope`, so a
 * test can import it in Node without side effects.
 */

import type { SfrConfig, UsfrConfig } from '@ncplanner/kernel';
import { runGenerator, type WorkerMessage, type WorkerStartRequest } from './driver.js';
import { parseGeneratorDocument } from './presets.js';
import type { PortableCell } from './grid.js';
import { registerAllMutators } from './index.js';
import { makeSfrGrid } from './reactors/sfr.js';
import { makeUsfrGrid } from './reactors/usfr.js';

/** The configuration the worker needs, injected by the host before a run. */
export interface WorkerConfiguration {
  readonly sfr?: SfrConfig;
  readonly usfr?: UsfrConfig;
}

let configuration: WorkerConfiguration = {};

/**
 * Install the kernel configuration the worker will run against.
 *
 * The configuration is ~1.2 MB of parsed JSON, so it is set once per worker rather
 * than attached to every start message.
 */
export function setWorkerConfiguration(next: WorkerConfiguration): void {
  configuration = next;
}

/** Handle one start request. Exported so it can be tested without a `Worker`. */
export async function handleStart(request: WorkerStartRequest): Promise<WorkerMessage> {
  try {
    registerAllMutators();
    const parsed = parseGeneratorDocument(request.generator);
    if (parsed === null) {
      return { type: 'error', message: 'the request carried no generator settings' };
    }
    const config = request.configKind === 'sfr' ? configuration.sfr : configuration.usfr;
    if (config === undefined) {
      return {
        type: 'error',
        message: `no ${request.configKind} configuration was installed in this worker`,
      };
    }
    const start =
      request.configKind === 'sfr'
        ? buildSfr(config as SfrConfig, request.dims)
        : buildUsfr(config as UsfrConfig, request.dims);

    const result = runGenerator({
      generator: parsed.generator as never,
      start: start as never,
      parsed: parsed as never,
      seed: request.seed,
      maxIterations: request.maxIterations,
    });

    const grid = (result.best as unknown as { toPortable(): (PortableCell | null)[] }).toPortable();
    return { type: 'result', grid };
  } catch (caught) {
    return {
      type: 'error',
      message: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

// Imported through the module graph to keep this file's top-level side effects
// conditional; see the header.

function buildSfr(config: SfrConfig, dims: readonly [number, number, number]): unknown {
  return makeSfrGrid(config, dims);
}

function buildUsfr(config: UsfrConfig, dims: readonly [number, number, number]): unknown {
  return makeUsfrGrid(config, dims);
}

/** True when this module is running inside a `WorkerGlobalScope`. */
export function isWorkerScope(scope: unknown = globalThis): boolean {
  const candidate = scope as { importScripts?: unknown; document?: unknown; postMessage?: unknown };
  return (
    typeof candidate.postMessage === 'function' &&
    typeof candidate.importScripts === 'function' &&
    candidate.document === undefined
  );
}

if (isWorkerScope()) {
  const scope = globalThis as unknown as {
    onmessage: ((event: { data: WorkerStartRequest | { type: 'configure'; configuration: WorkerConfiguration } }) => void) | null;
    postMessage(message: WorkerMessage): void;
  };
  scope.onmessage = (event): void => {
    const data = event.data;
    if (data.type === 'configure') {
      setWorkerConfiguration((data as { configuration: WorkerConfiguration }).configuration);
      return;
    }
    void handleStart(data).then((message) => scope.postMessage(message));
  };
}

export type { WorkerMessage, WorkerStartRequest };
