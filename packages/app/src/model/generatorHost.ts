/**
 * R4.4 — the generator's host implementation for the app.
 *
 * Three responsibilities, kept apart from the panel (which is presentation only):
 *
 *  1. **Preset loading.** Parse each shipped preset and note the configuration it was
 *     written against. The presets carry a *stripped* six-block configuration, so their
 *     stored indices are meaningless against the real one until translated.
 *  2. **Translating and binding.** Re-express each index list as "every real block with
 *     these function modules" (`compiled-import.ts`), then bind the preset's variable
 *     references now that a grid exists.
 *  3. **Running and applying.** A single-threaded run here (the worker variant lives in
 *     `generatorWorker.ts`), and a write-back through the bridge.
 *
 * ## Why the translation lives in the app and not in `@ncplanner/generator`
 *
 * `importFrom` needs the *file's own* configuration, which only a project loader knows.
 * The generator package has no loader and must not grow one — it would drag `node:fs`
 * into the worker bundle. So the host reads the preset's embedded configuration, which
 * is also the right place for a user-visible "this preset does not match" error.
 */

import type { Configuration } from '@ncplanner/ncpf';
import {
  bindGenerator,
  importSfrIndices,
  importUsfrIndices,
  parseGeneratorDocument,
  runGenerator,
  type ParsedGenerator,
  type SfrGeneratorGrid,
  type UsfrGeneratorGrid,
} from '@ncplanner/generator';
import type { SfrConfig, UsfrConfig } from '@ncplanner/kernel';
import type { GridState } from './grid.js';
import { cloneGrid } from './grid.js';
import { fromGeneratorGrid, toGeneratorGrid, type GeneratorKind } from './generatorBridge.js';

/** A generator grid for either supported reactor. */
export type AnyGeneratorGrid = SfrGeneratorGrid | UsfrGeneratorGrid;

/** One shipped preset, as loaded from disk. */
export interface LoadedPreset {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** The raw JSON, kept so a worker can be sent the same document. */
  readonly document: unknown;
  /** The configuration the preset's indices were written against. */
  readonly source: Configuration | undefined;
}

/** The four presets the repository ships, and the reactor each targets. */
export const PRESET_FILES: readonly { id: string; kind: GeneratorKind }[] = [
  { id: 'overhaul_sfr/efficiency', kind: 'sfr' },
  { id: 'overhaul_sfr/output', kind: 'sfr' },
  { id: 'underhaul_sfr/efficiency', kind: 'usfr' },
  { id: 'underhaul_sfr/output', kind: 'usfr' },
];

/** Build the preset list for one reactor from already-parsed documents. */
export function describePresets(
  documents: Readonly<Record<string, unknown>>,
  kind: GeneratorKind,
): LoadedPreset[] {
  const out: LoadedPreset[] = [];
  for (const entry of PRESET_FILES) {
    if (entry.kind !== kind) continue;
    const document = documents[entry.id];
    if (document === undefined) continue;
    const parsed = parseGeneratorDocument(document);
    if (parsed === null) continue;
    const steps = parsed.generator.stages.reduce((sum, stage) => sum + stage.steps.length, 0);
    out.push({
      id: entry.id,
      label: parsed.generator.name,
      detail: `${parsed.generator.stages.length} stages / ${steps} steps`,
      document,
      source: embeddedConfiguration(document, kind),
    });
  }
  return out;
}

/** The stripped configuration a preset carries inside itself. */
function embeddedConfiguration(
  document: unknown,
  kind: GeneratorKind,
): Configuration | undefined {
  const root = document as { configuration?: Record<string, unknown> } | null;
  const id = kind === 'sfr' ? 'nuclearcraft:overhaul_sfr' : 'nuclearcraft:underhaul_sfr';
  const configuration = root?.configuration?.[id];
  return configuration === undefined ? undefined : (configuration as Configuration);
}

export interface PreparedRun {
  readonly grid: AnyGeneratorGrid;
  /** `null` when the preset's document held no generator settings. */
  readonly parsed: ParsedGenerator<AnyGeneratorGrid> | null;
}

/**
 * Build a generator grid from a design and prepare the preset for it.
 *
 * The design is *copied* into the generator's index space, so a cancelled run can never
 * have touched the editor's state: the search mutates its own grid and the editor sees
 * nothing until the result is applied.
 */
export function prepareRun(options: {
  design: GridState;
  config: SfrConfig | UsfrConfig;
  kind: GeneratorKind;
  preset: LoadedPreset;
}): PreparedRun {
  const { grid } = toGeneratorGrid(options.design, options.config, options.kind);
  // Parse first, then translate **these** mutators. Parsing a second copy to translate
  // and then running the first would leave the search on placeholder indices, which
  // looks like a working run that never improves anything.
  const parsed = parseGeneratorDocument<AnyGeneratorGrid>(options.preset.document);
  if (parsed === null) return { grid, parsed: null };
  translateIndices(grid, parsed, options.preset, options.kind);
  // Bind before running: the preset's expressions address `multiblock2.*`, which is
  // filled per iteration from a second grid.
  bindGenerator(parsed, {
    generator: parsed.generator,
    original: grid,
    priorityMultiblock: grid.copy(),
  });
  return { grid, parsed };
}

/**
 * Translate a preset's index lists into the target configuration's space.
 *
 * Takes the **parsed** generator, not its document: the translation has to reach the
 * mutator objects the search will actually call. Parsing a private copy here (an earlier
 * revision did) translates objects nobody runs, and the symptom is not an error — it is a
 * run that reports thousands of iterations and improves nothing.
 *
 * Exported because it is the single most likely thing to get wrong, and it is tested
 * directly: skipping it leaves `random_cell` with an empty fuel-cell list (measured).
 */
export function translateIndices(
  grid: AnyGeneratorGrid,
  parsed: ParsedGenerator<AnyGeneratorGrid>,
  preset: LoadedPreset,
  kind: GeneratorKind,
): void {
  const source = preset.source;
  if (source === undefined) return;
  for (const stage of parsed.generator.stages) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const indices = (
        step.mutator as { indicies?: { get(): number[]; set(v: number[]): void } }
      ).indicies;
      if (indices === undefined) continue;
      indices.set(
        kind === 'sfr'
          ? importSfrIndices(indices.get(), source, grid.compiled as never)
          : importUsfrIndices(indices.get(), source, grid.compiled as never),
      );
      step.mutator.setIndicies(grid);
    }
  }
}

export interface RunOutcome {
  readonly grid: AnyGeneratorGrid;
  readonly iterations: number;
  readonly upgrades: number;
  readonly stop: 'completed' | 'cancelled';
  readonly best: string;
}

/**
 * Run a prepared search on the calling thread.
 *
 * Progress is throttled to ~4 Hz. A message per iteration would dominate the search —
 * at the measured ~1 900 iterations/second a per-iteration callback is 1 900 DOM updates
 * a second, which is slower than the physics.
 */
export function runPrepared(options: {
  prepared: PreparedRun;
  start: AnyGeneratorGrid;
  seed: number;
  iterations: number;
  signal: { cancelled: boolean };
  onProgress: (progress: {
    iterations: number;
    perSecond: number;
    stage: number;
    upgrades: number;
    best: string;
  }) => void;
}): RunOutcome {
  const { prepared } = options;
  if (prepared.parsed === null) {
    throw new Error('the preset carries no generator settings; nothing to run');
  }
  const started = Date.now();
  let tick = 0;
  let lastReport = 0;
  let upgrades = 0;

  const result = runGenerator<AnyGeneratorGrid>({
    generator: prepared.parsed.generator,
    parsed: prepared.parsed,
    start: options.start,
    seed: options.seed,
    maxIterations: options.iterations,
    shouldStop: () => options.signal.cancelled,
    onIteration: () => {
      tick++;
      const now = Date.now();
      if (now - lastReport < 250) return;
      lastReport = now;
      const elapsed = Math.max(1, now - started);
      options.onProgress({
        iterations: tick,
        perSecond: Math.round((tick / elapsed) * 1_000),
        stage: prepared.parsed?.generator.stage ?? 0,
        upgrades,
        best: options.start.tooltip(),
      });
    },
  });

  upgrades = result.upgrades;
  return {
    grid: result.best,
    iterations: result.iterations,
    upgrades,
    stop: options.signal.cancelled ? 'cancelled' : 'completed',
    best: result.best.tooltip(),
  };
}

/** Apply a run's winning grid to the open design, returning a fresh state to load. */
export function applyOutcome(design: GridState, outcome: RunOutcome): GridState {
  const next = cloneGrid(design);
  fromGeneratorGrid(next, outcome.grid);
  return next;
}
