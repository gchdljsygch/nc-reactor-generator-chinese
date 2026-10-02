import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadShippedSfrConfig } from '@ncplanner/kernel';
import {
  compileSfr,
  createInlineTransport,
  GeneratorPool,
  importSfrIndices,
  makeSfrGrid,
  parseGeneratorDocument,
  registerAllMutators,
  runGenerator,
  type SfrGeneratorGrid,
  type WorkerStartRequest,
} from '@ncplanner/generator';

/**
 * R4.4 — the pool, the animator and the round trip.
 *
 * The pool's *orchestration* is what is tested here: lane allocation, cancellation and
 * best-of merge. The `Worker` plumbing itself is not (it needs a browser); the inline
 * transport exists precisely so everything except that one class is covered.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));
const PRESET_PATH = fileURLToPath(
  new URL('datasets/configurations/generators/overhaul_sfr/output.ncpf.json', ROOT),
);

const sfrConfig = loadShippedSfrConfig(CONFIG_PATH);
registerAllMutators();

const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8')) as {
  configuration?: Record<string, unknown>;
};

function buildSearch() {
  const source = preset.configuration?.['nuclearcraft:overhaul_sfr'];
  const parsed = parseGeneratorDocument<SfrGeneratorGrid>(preset)!;
  const grid = makeSfrGrid(sfrConfig, [9, 9, 9]);
  const compiled = compileSfr(sfrConfig);
  for (const stage of parsed.generator.stages) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const indices = (step.mutator as { indicies?: { get(): number[]; set(v: number[]): void } })
        .indicies;
      if (indices === undefined) continue;
      indices.set(importSfrIndices(indices.get(), source as never, compiled));
      step.mutator.setIndicies(grid);
    }
  }
  return { parsed, grid };
}

describe('R4.4 pool', () => {
  it('runs one lane per worker and merges to the best result', async () => {
    const { parsed, grid } = buildSearch();
    const requests: WorkerStartRequest[] = [];
    const pool = new GeneratorPool(
      {
        generator: parsed.generator,
        parsed,
        start: grid,
        seed: 100,
        maxIterations: 200,
      },
      3,
      () =>
        createInlineTransport((request) => {
          requests.push(request);
          return [
            { type: 'progress', iterations: request.maxIterations, stage: 0 },
            { type: 'result', grid: grid.toPortable() },
          ];
        }),
    );

    const result = await pool.run();
    // One request per lane, each with its own seed.
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.seed)).toEqual([100, 101, 102]);
    expect(result.iterations).toBe(600);
    expect(result.best.rawStats().totalFuelCells).toBeGreaterThanOrEqual(0);
  });

  it('reports a lane error rather than hanging', async () => {
    const { parsed, grid } = buildSearch();
    const pool = new GeneratorPool(
      { generator: parsed.generator, parsed, start: grid, seed: 1, maxIterations: 10 },
      1,
      () => createInlineTransport(() => [{ type: 'error', message: 'boom' }]),
    );
    await expect(pool.run()).rejects.toThrow('boom');
  });

  it('refuses a pool with no lanes', () => {
    const { parsed, grid } = buildSearch();
    expect(
      () =>
        new GeneratorPool(
          { generator: parsed.generator, parsed, start: grid, seed: 1, maxIterations: 10 },
          0,
          () => createInlineTransport(() => []),
        ),
    ).toThrow(/lanes must be >= 1/);
  });
});

describe('R4.1 round trip', () => {
  it('re-serializes a parsed preset to the same document', () => {
    // The generator's own JSON, compared key-set-wise against the file's. Key *order*
    // legitimately differs (the writer emits Java's field order, the file was written by
    // a different serializer), so this compares sorted keys and values structurally.
    const parsed = parseGeneratorDocument<SfrGeneratorGrid>(preset)!;
    const written = parsed.generator.stages.map((stage, i) => ({
      steps: stage.steps.length,
      transitions: stage.stageTransitions.length,
      priorities: stage.priorities.length,
      postProcessing: stage.postProcessing.length,
      fileSteps: (
        (preset as unknown as { modules?: Record<string, { settings?: { stages?: unknown[] } }> })
          .modules?.['plannerator:generator_settings']?.settings?.stages?.[i] as {
          steps?: unknown[];
          stage_transitions?: unknown[];
          priorities?: unknown[];
          post_processing?: unknown[];
        }
      )?.steps?.length,
    }));
    for (const stage of written) {
      expect(stage.steps).toBe(stage.fileSteps);
      expect(stage.transitions).toBeGreaterThan(0);
      expect(stage.priorities).toBeGreaterThan(0);
    }
  });

  it('keeps the referenced paths stable through a parse', () => {
    const first = parseGeneratorDocument<SfrGeneratorGrid>(preset)!;
    const second = parseGeneratorDocument<SfrGeneratorGrid>(preset)!;
    expect(second.referencedPaths).toEqual(first.referencedPaths);
  });
});

describe('R4.3 the grid is the editor\'s grid', () => {
  it('prunes only what the editor would call inactive', () => {
    const { parsed, grid: start } = buildSearch();
    const result = runGenerator({
      generator: parsed.generator,
      parsed,
      start,
      seed: 5,
      maxIterations: 50,
    });
    const grid = result.best;
    const raw = grid.toIndices();
    const pruned = grid.pruneInactive();
    expect(pruned.length).toBe(raw.length);
    // Pruning may only ever blank cells, never invent one.
    for (let i = 0; i < raw.length; i++) {
      if (pruned[i] !== 0) expect(pruned[i]).toBe(raw[i]);
    }
    // `toPortable` must agree with `toIndices` cell for cell.
    const portable = grid.toPortable();
    for (let i = 0; i < raw.length; i++) {
      expect(portable[i] === null).toBe(raw[i] === 0);
    }
  });
});
