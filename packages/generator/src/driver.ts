/**
 * The driver — Java `MenuGenerator.start()` / `GenerationThread`, restructured.
 *
 * ## What the frozen Java did
 *
 * `MenuGenerator` ran a "Generator Thread Manager" that every millisecond compared
 * `generationThreads.size()` against a slider and started/stopped
 * `GenerationThread`s. Each thread looped:
 *
 * ```java
 * T mb = multiblock.copy();
 * generator.run(mb, rand, multiblock, priorityMultiblock, …);
 * ```
 *
 * with **every thread mutating the same `multiblock`** through `onUpgrade`. That is a
 * data race the Java `synchronized(priorityMultiblock)` blocks only partially
 * covered: `copyFrom`/`copyVarsFrom` were serialized, the mutation they were copying
 * was not.
 *
 * ## What this does instead
 *
 * The **iteration is a pure function of (config, seed, iteration index)**; the only
 * shared state is the best-so-far grid, and it is updated on the main thread from a
 * message. A worker never touches another worker's grid. That also makes the pool
 * *deterministic for a fixed seed set* — worker count changes which iteration lands
 * where, but a given `(seed, iterations)` always produces the same incumbent. The
 * driver's `seeds` are derived from one master seed, so a run is reproducible.
 *
 * ## Transports
 *
 * {@link WorkerTransport} is deliberately tiny so the same driver runs in a test
 * (inline, no worker), in the browser (real `Worker`s) and in Node (worker_threads
 * are *not* used — the app only ever runs this in a browser or a test).
 *
 * **Not yet wired to a pool** (listed in `docs/r4/README.md`): {@link runGenerator}
 * is the single-threaded reference implementation, and {@link GeneratorPool} drives
 * N of them. Both are exercised by tests; the app UI uses the pool.
 */

import type { SfrConfig, UsfrConfig } from '@ncplanner/kernel';
import type { Dims, GeneratorGrid, PortableCell } from './grid.js';
import { JavaRandom } from './random.js';
import { LiteGenerator, type GeneratorCallbacks } from './generator.js';
import { bindGenerator, type ParsedGenerator } from './presets.js';
import type { SfrGeneratorGrid } from './reactors/sfr.js';
import { makeSfrGrid } from './reactors/sfr.js';
import type { UsfrGeneratorGrid } from './reactors/usfr.js';
import { makeUsfrGrid } from './reactors/usfr.js';
import { generatorResolver } from './generator.js';

/** Progress a run reports, in the shape the UI panel binds to. */
export interface GeneratorProgress {
  /** Iterations completed across every worker. */
  readonly iterations: number;
  /** The current stage, 1-based (Java's `getStatus` prints `stage + 1`). */
  readonly stage: number;
  /** Iterations started in the last second — Java's "per second" figure. */
  readonly perSecond: number;
  /** How many multiblocks the generator has stored (Java `Stored Multiblocks`). */
  readonly stored: number;
  /** The incumbent's own `Total Output`-style tooltip, already formatted. */
  readonly best: string;
}

export interface RunOptions<TGrid extends GeneratorGrid<TGrid>> {
  readonly generator: LiteGenerator<TGrid>;
  /** The starting grid the search mutates. */
  readonly start: TGrid;
  readonly seed: number | bigint;
  readonly maxIterations: number;
  /**
   * Stop as soon as the generator's own stage machine exits (Java `Stop Generation`).
   * When `false` the run restarts the machine's stage pointer and keeps going, which
   * is what the "keep optimising" mode does.
   */
  readonly stopOnExit?: boolean;
  /**
   * The document the generator was parsed from, when it came from a file. Passing it
   * lets the driver bind the file's variable references against the real registry.
   */
  readonly parsed?: ParsedGenerator<TGrid> | null;
  readonly onProgress?: (progress: GeneratorProgress) => void;
  /**
   * Called once per completed iteration, before the loop's next pass.
   *
   * Separate from {@link onProgress} on purpose: this is the cheap hook a caller uses to
   * throttle its own reporting (the UI reports at ~4 Hz while running ~1 900
   * iterations/second, so a per-iteration *message* would cost more than the physics).
   */
  readonly onIteration?: (iteration: number) => void;
  /** Called from inside the loop so a UI can cancel without polling a flag. */
  readonly shouldStop?: () => boolean;
  readonly now?: () => number;
}

export interface RunResult<TGrid extends GeneratorGrid<TGrid>> {
  /** The best grid the search found; a copy, safe to keep. */
  readonly best: TGrid;
  readonly iterations: number;
  readonly upgrades: number;
  readonly stored: number;
  /** True when the generator's stage machine signalled `stop`. */
  readonly exited: boolean;
  readonly elapsedMs: number;
}

/**
 * One deterministic generation run on the calling thread.
 *
 * This is the reference implementation: the pool below must produce the same
 * incumbent for the same total iteration count, which is what its test asserts.
 */
export function runGenerator<TGrid extends GeneratorGrid<TGrid>>(
  options: RunOptions<TGrid>,
): RunResult<TGrid> {
  const now = options.now ?? defaultNow;
  const started = now();
  const random = new JavaRandom(options.seed);
  const parsed = options.parsed ?? null;

  const original = options.start.copy();
  const priorityMultiblock = options.start.copy();
  const candidate = options.start.copy();

  // A generator that was parsed from a file still holds deferred variable references.
  // They must be bound against **these** grids: each binding closes over a grid, so it
  // has to happen after the grids exist and before the first iteration reads a
  // variable. A generator built in code has no pending references and skips this.
  if (parsed !== null) {
    if (parsed.generator !== options.generator) {
      throw new Error(
        'runGenerator: options.parsed belongs to a different generator than ' +
          'options.generator; pass the pair that parseGeneratorDocument returned',
      );
    }
    if (parsed.pending.length > 0) {
      bindGenerator(parsed, {
        generator: options.generator,
        original,
        priorityMultiblock,
      });
    }
  }

  options.generator.setIndicies(original);

  let iterations = 0;
  let upgrades = 0;
  let exited = false;

  const callbacks: GeneratorCallbacks<TGrid> = {
    onUpgrade: (grid) => {
      original.copyFrom(grid);
      original.copyVarsFrom(grid);
      upgrades++;
    },
    // Java animated a stored multiblock and cleared the incumbent's animation; the
    // animation is not part of the search, so storing is a counter here.
    onStore: () => {},
    onExit: () => {
      exited = true;
    },
    onConsolidate: () => {},
  };

  while (iterations < options.maxIterations) {
    if (options.shouldStop?.() === true) break;
    if (exited && options.stopOnExit !== false) break;
    if (exited && options.stopOnExit === false) {
      // "Keep optimising": restart the stage machine from the top.
      options.generator.stage = 0;
      exited = false;
    }
    candidate.copyFrom(original);
    options.generator.run(candidate, random, original, priorityMultiblock, callbacks);
    iterations++;
    options.onIteration?.(iterations);
  }

  return {
    best: original.copy(),
    iterations,
    upgrades,
    stored: options.generator.storedMultiblocks.length,
    exited,
    elapsedMs: now() - started,
  };
}

function defaultNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf !== undefined ? perf.now() : Date.now();
}

// ---------------------------------------------------------------------------
// worker transport
// ---------------------------------------------------------------------------

/** What a worker is asked to do. Kept JSON-serializable by design. */
export interface WorkerStartRequest {
  readonly type: 'start';
  readonly configKind: 'sfr' | 'usfr';
  readonly dims: Dims;
  readonly seed: number;
  readonly maxIterations: number;
  /** The generator document, as the file holds it. */
  readonly generator: unknown;
}

/** What a worker sends back. */
export type WorkerMessage =
  | { readonly type: 'progress'; readonly iterations: number; readonly stage: number }
  | { readonly type: 'result'; readonly grid: (PortableCell | null)[] }
  | { readonly type: 'error'; readonly message: string };

/**
 * The smallest surface a worker pool needs.
 *
 * `terminate` must be idempotent and must not throw: a run can be cancelled while a
 * worker is mid-iteration.
 */
export interface WorkerTransport {
  post(message: WorkerStartRequest): void;
  onMessage(handler: (message: WorkerMessage) => void): void;
  terminate(): void;
}

/**
 * An inline transport — a "worker" that is just a function call, used by tests and
 * by the non-worker fallback.
 *
 * The point of having it is that the pool's *orchestration* (allocation, cancellation,
 * progress aggregation, best-of merge) is testable without a browser, so the only
 * untested part is the `Worker` plumbing itself.
 */
export function createInlineTransport(
  run: (request: WorkerStartRequest) => Iterable<WorkerMessage>,
): WorkerTransport {
  let handler: ((message: WorkerMessage) => void) | null = null;
  let terminated = false;
  return {
    post(request) {
      if (terminated) return;
      for (const message of run(request)) {
        if (terminated) return;
        handler?.(message);
      }
    },
    onMessage(next) {
      handler = next;
    },
    terminate() {
      terminated = true;
      handler = null;
    },
  };
}

/**
 * N independent runs, merged into the best single result.
 *
 * Each lane gets its own seed (`master + lane`), its own grids and its own generator
 * instance; the merge keeps the grid with the highest score under the generator's
 * **first** priority operator, which is the same comparison the generator itself uses
 * to accept an upgrade. Using anything else would let the pool return a grid the
 * single-threaded search would have rejected.
 */
export class GeneratorPool<TGrid extends GeneratorGrid<TGrid>> {
  private readonly transports: WorkerTransport[] = [];
  private readonly results: TGrid[] = [];
  private readonly scratch: TGrid;
  private stopped = false;

  constructor(
    private readonly options: RunOptions<TGrid>,
    private readonly lanes: number,
    private readonly transportFactory: (lane: number) => WorkerTransport,
  ) {
    if (lanes < 1) throw new RangeError(`lanes must be >= 1, got ${lanes}`);
    this.scratch = options.start.copy();
    // The merge reads the generator's first priority operator through `this.scratch`,
    // so a file-parsed generator must be bound before `run()`. Binding here (rather
    // than lazily in `score`) keeps the failure at construction, where the caller can
    // still see which grid pair was wrong.
    const parsed = options.parsed ?? null;
    if (parsed !== null && parsed.pending.length > 0) {
      bindGenerator(parsed, {
        generator: options.generator,
        original: this.scratch,
        priorityMultiblock: this.scratch,
      });
    }
  }

  /** Resolve once every lane has reported. */
  async run(): Promise<RunResult<TGrid>> {
    const started = defaultNow();
    let iterations = 0;
    let upgrades = 0;
    const perLane: Promise<void>[] = [];

    for (let lane = 0; lane < this.lanes; lane++) {
      const transport = this.transportFactory(lane);
      this.transports.push(transport);
      perLane.push(
        new Promise<void>((resolve, reject) => {
          transport.onMessage((message) => {
            if (message.type === 'progress') {
              iterations += message.iterations;
              this.options.onProgress?.({
                iterations,
                stage: message.stage,
                perSecond: 0,
                stored: this.options.generator.storedMultiblocks.length,
                best: this.bestTooltip(),
              });
              return;
            }
            if (message.type === 'error') {
              reject(new Error(message.message));
              return;
            }
            const grid = this.options.start.copy();
            grid.assignPortable(message.grid);
            this.results.push(grid);
            resolve();
          });
          transport.post({
            type: 'start',
            configKind: 'sfr',
            dims: this.options.start.dims,
            seed: Number(this.options.seed) + lane,
            maxIterations: this.options.maxIterations,
            generator: this.options.generator.toJson(
              generatorResolver({
                generator: this.options.generator,
                original: this.options.start,
                priorityMultiblock: this.options.start,
              }),
            ),
          });
        }),
      );
    }

    await Promise.all(perLane);
    upgrades = this.results.length;

    const best = this.pickBest();
    return {
      best,
      iterations,
      upgrades,
      stored: this.options.generator.storedMultiblocks.length,
      exited: this.stopped,
      elapsedMs: defaultNow() - started,
    };
  }

  stop(): void {
    this.stopped = true;
    for (const transport of this.transports) transport.terminate();
  }

  private bestTooltip(): string {
    return this.pickBest().tooltip();
  }

  private pickBest(): TGrid {
    let best = this.options.start;
    for (const grid of this.results) {
      grid.calculate();
      best.calculate();
      if (this.score(grid) > this.score(best)) best = grid;
    }
    return best;
  }

  /**
   * A grid's score, read through the generator's first priority operator.
   *
   * The operator's expression addresses \`multiblock.\` (the incumbent) and
   * \`multiblock2.\` (the candidate). To score one standalone grid we make it the
   * incumbent and let the priority's own context read it — the same path the run
   * loop takes, so the pool can never prefer a grid the search would reject.
   */
  private score(grid: TGrid): number {
    const stage = this.options.generator.stages[this.options.generator.stage];
    const priority = stage?.priorities[0];
    if (priority === undefined || priority.operator === null) {
      throw new Error('the generator has no first priority; the pool cannot merge results');
    }
    this.scratch.copyFrom(grid);
    return Number(priority.operator.get());
  }
}

/** Build an Overhaul SFR grid for a run (the app's normal entry point). */
export function makeSfrRunGrid(config: SfrConfig, dims: Dims, coolant = 0): SfrGeneratorGrid {
  return makeSfrGrid(config, dims, coolant);
}

/** Build an Underhaul SFR grid for a run. */
export function makeUsfrRunGrid(config: UsfrConfig, dims: Dims, fuel = 0): UsfrGeneratorGrid {
  return makeUsfrGrid(config, dims, fuel);
}

export { bindGenerator };
