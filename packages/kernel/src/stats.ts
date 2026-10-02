import type { GoldenNumber, GoldenRecord } from './dataset.js';

/**
 * Golden comparison — the R1 acceptance rule.
 *
 * Field mapping and tolerances are those of `docs/rewrite-plan-r1-r5.md` §3.1:
 *
 *  - integer fields must match **exactly** (R0's divergences were integer-level,
 *    not float noise);
 *  - float fields compare with a relative 1e-5 tolerance (the R0 divergence
 *    detector's threshold; R1.0a's determinism measurement shows the frozen
 *    engine is bit-for-bit repeatable, so this could be tightened further);
 *  - `"NaN"` / `"Infinity"` in the golden record mean "the reference engine has
 *    no value here" → the field is **skipped**, never compared;
 *  - values below 1e-12 are treated as 0 (the frozen engine underflows through
 *    `sparsityMult` chains);
 *  - `shutdownFactor` is compared on its R1 domain `[0, 1]`, which is applied to
 *    **both** sides (the frozen engine leaks `NaN` and 13 out-of-range values).
 */

/** Overhaul SFR integer-valued statistics (§3.1.2). */
export const SFR_INTEGER_FIELDS = new Set([
  'totalFuelCells',
  'rawOutput',
  'totalCooling',
  'totalHeat',
  'netHeat',
  'totalIrradiation',
  'functionalBlocks',
  'numControllers',
  'missingCasings',
]);

/** Underhaul SFR integer-valued statistics (§3.1.2). */
export const USFR_INTEGER_FIELDS = new Set([
  'cells',
  'functionalBlocks',
  'numControllers',
  'missingCasings',
]);

/**
 * Overhaul MSR integer-valued statistics.
 *
 * Derived from the Java field declarations in
 * `multiblock/overhaul/fissionmsr/OverhaulMSR.java` (the reflection dump in
 * `tools/golden/.../GoldenGen.java` records every non-static `int`/`float`/
 * `double`/`long` field):
 *
 * | field | Java | line |
 * |---|---|---|
 * | `totalFuelVessels` | `int` | `OverhaulMSR.java:60` |
 * | `totalCooling` | `int` | `:61` |
 * | `totalHeat` | `int` | `:62` |
 * | `netHeat` | `int` | `:63` |
 * | `totalIrradiation` | `int` | `:66` |
 * | `functionalBlocks` | `int` | `:67` |
 * | `numControllers` | `int` | `:78` |
 * | `missingCasings` | `int` | `:79` |
 *
 * The remaining golden fields (`totalEfficiency`, `totalHeatMult`,
 * `sparsityMult`, `totalTotalOutput`, `shutdownFactor`, `offOutput`) are `float`.
 */
export const MSR_INTEGER_FIELDS = new Set([
  'totalFuelVessels',
  'totalCooling',
  'totalHeat',
  'netHeat',
  'totalIrradiation',
  'functionalBlocks',
  'numControllers',
  'missingCasings',
]);

/**
 * Overhaul Turbine integer-valued statistics.
 *
 * Derived from `multiblock/overhaul/turbine/OverhaulTurbine.java`:
 *
 * | field | Java | line |
 * |---|---|---|
 * | `bearingDiameter` | `int` | `:60` |
 * | `bladeCount` | `int` (private) | `:45` |
 * | `maxInput` | `int` | `:47` |
 * | `maxUnsafeInput` | `int` | `:48` |
 * | `totalOutput` | `long` (`(long)(double)`) | `:54` |
 * | `safeOutput` | `long` | `:54` |
 * | `unsafeOutput` | `long` | `:54` |
 * | `numControllers` | `int` | `:64` |
 * | `missingCasings` | `int` | `:65` |
 *
 * The remaining golden fields (`rotorEfficiency`, `coilEfficiency`) are `float`;
 * `throughputEfficiency`, `idealityMultiplier`, `totalEfficiency` and
 * `totalFluidEfficiency` are `double`.
 */
export const TURBINE_INTEGER_FIELDS = new Set([
  'bearingDiameter',
  'bladeCount',
  'maxInput',
  'maxUnsafeInput',
  'totalOutput',
  'safeOutput',
  'unsafeOutput',
  'numControllers',
  'missingCasings',
]);

export interface CompareOptions {
  relTolerance: number;
  integerFields: ReadonlySet<string>;
}

export const DEFAULT_OPTIONS: CompareOptions = {
  relTolerance: 1e-5,
  integerFields: SFR_INTEGER_FIELDS,
};

export interface FieldMismatch {
  field: string;
  expected: number;
  actual: number;
  /** Relative difference (0 for exact-integer mismatches of 0/0). */
  relDiff: number;
}

function goldenToNumber(v: GoldenNumber | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return v;
  return null; // "NaN" / "Infinity" / "-Infinity" → no reference value
}

/** §3.1.5: clamp `shutdownFactor` onto its defined domain. */
export function normalizeShutdownFactorField(value: number, totalOutput: number): number {
  if (totalOutput === 0) return 0;
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function denormalize(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export function compareStats(
  actual: Readonly<Record<string, number>>,
  golden: Readonly<Record<string, GoldenNumber>>,
  options: CompareOptions = DEFAULT_OPTIONS,
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];
  const goldenTotalOutput = goldenToNumber(golden['totalOutput']);
  const actualTotalOutput = actual['totalOutput'] ?? 0;
  for (const [field, goldenValue] of Object.entries(golden)) {
    const expectedRaw = goldenToNumber(goldenValue);
    if (expectedRaw === null) continue; // reference undefined → skip
    const actualRaw = actual[field];
    if (actualRaw === undefined) {
      mismatches.push({ field, expected: expectedRaw, actual: Number.NaN, relDiff: Number.NaN });
      continue;
    }
    let expected = expectedRaw;
    let got = actualRaw;
    if (field === 'shutdownFactor') {
      expected = normalizeShutdownFactorField(expected, goldenTotalOutput ?? 0);
      got = normalizeShutdownFactorField(got, actualTotalOutput);
    }
    expected = denormalize(expected);
    got = denormalize(got);
    if (options.integerFields.has(field)) {
      if (expected !== got) {
        mismatches.push({ field, expected, actual: got, relDiff: relDiff(expected, got) });
      }
      continue;
    }
    if (expected === got) continue;
    if (Number.isNaN(got) !== Number.isNaN(expected)) {
      mismatches.push({ field, expected, actual: got, relDiff: Number.NaN });
      continue;
    }
    const scale = Math.max(1e-9, Math.abs(expected), Math.abs(got));
    const diff = Math.abs(expected - got) / scale;
    if (diff > options.relTolerance) {
      mismatches.push({ field, expected, actual: got, relDiff: diff });
    }
  }
  return mismatches;
}

function relDiff(a: number, b: number): number {
  const scale = Math.max(1e-9, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale;
}

/** §3.1.4: every statistic must be a finite number. */
export function allFinite(stats: Readonly<Record<string, number>>): boolean {
  for (const v of Object.values(stats)) if (!Number.isFinite(v)) return false;
  return true;
}

/** Fields the frozen engine reports as NaN for a record (diagnostics). */
export function goldenNanFields(record: GoldenRecord): string[] {
  return Object.entries(record.editor)
    .filter(([, v]) => typeof v !== 'number')
    .map(([k]) => k);
}

/**
 * Projection of the R0 dataset's `divergence` block: which fields the two old
 * engines disagreed on, and by how much. Used to prioritise the
 * "most likely to be wrong" regions (moderator lines / cluster building).
 */
export function divergenceFields(record: GoldenRecord): string[] {
  return Object.keys(record.divergence).filter((k) => !k.startsWith('__'));
}
