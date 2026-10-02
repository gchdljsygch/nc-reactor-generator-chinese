import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadShippedSfrConfig, readGoldenDataset, rebuildSfr } from '@ncplanner/kernel';

/**
 * R1.0e regression guard.
 *
 * The R0 dataset (`datasetVersion 2`) recorded templates with
 * `NCPFElement.getName()`, which is **not injective**: 16 heat-sink variants and
 * both reflector variants share a name. Dataset v3 switched to
 * `NCPFElementDefinition.toString()`.
 *
 * This test pins both halves of that finding down:
 *
 *  - v2 *must* still look ambiguous (if it stopped looking ambiguous, the
 *    rebuild's fallback — and therefore this sentinel — would be broken);
 *  - v3 *must* be unambiguous (if it stopped being unambiguous, the dataset
 *    generation regressed to the lossy naming and every physics comparison
 *    downstream becomes untrustworthy).
 *
 * See `docs/r1/r1.0-dataset-naming.md`.
 */

const ROOT = new URL('../../../', import.meta.url);
const config = loadShippedSfrConfig(
  fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT)),
);

function ambiguityOf(datasetPath: string, limit: number) {
  const dataset = readGoldenDataset(fileURLToPath(new URL(datasetPath, ROOT)));
  const ambiguous = new Set<string>();
  const unresolved = new Set<string>();
  for (const record of dataset.records.slice(0, limit)) {
    const result = rebuildSfr(config, record);
    for (const a of result.ambiguous) ambiguous.add(a.name);
    for (const u of result.unresolved) unresolved.add(u);
  }
  return { ambiguous, unresolved, meta: dataset.meta };
}

describe('golden dataset template naming (R1.0e)', () => {
  it('detects the lossy v2 naming as ambiguous', () => {
    const v2 = ambiguityOf('datasets/golden/sfr-cases.v2.jsonl.gz', 200);
    expect(v2.meta.datasetVersion).toBe(2);
    expect([...v2.unresolved]).toEqual([]);
    // The fallback had to guess for at least one template in the first 200 cases.
    expect(v2.ambiguous.size).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`v2 ambiguous template names: ${[...v2.ambiguous].join(', ')}`);
  });

  it('resolves every v3 template by identity', () => {
    const v3 = ambiguityOf('datasets/golden/sfr-cases.jsonl.gz', 200);
    expect(v3.meta.datasetVersion).toBe(3);
    expect(v3.meta['templateNaming']).toBe('NCPFElementDefinition.toString() (injective)');
    expect([...v3.ambiguous]).toEqual([]);
    expect([...v3.unresolved]).toEqual([]);
  });
});
