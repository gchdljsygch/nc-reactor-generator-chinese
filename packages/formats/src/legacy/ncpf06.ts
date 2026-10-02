/**
 * LegacyNCPF **v6** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF6Reader.java`.
 *
 * v6 is where the turbine throughput-efficiency tolerances became hard-coded
 * constants instead of configuration fields. v9's `loadTurbineEfficiencyFactors`
 * returns the two values (Java assigns them straight into the settings module),
 * so the override simply returns the constants.
 */
import { javaFloat } from './ncpf11.js';
import { LegacyNCPF7Reader } from './ncpf07.js';

/** LegacyNCPF v6 — fixed turbine efficiency tolerances. */
export class LegacyNCPF6Reader extends LegacyNCPF7Reader {
  override readonly name: string = 'LegacyNCPF6Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 6;

  /** Java `getTargetVersion` (`:7-10`). */
  protected override getTargetVersion(): number {
    return 6;
  }

  /**
   * Java `loadTurbineEfficiencyFactors` (`:11-15`):
   * `settings.throughputEfficiencyLeniencyMultiplier = .5f` and
   * `settings.throughputEfficiencyLeniencyThreshold = .75f`.
   */
  protected override loadTurbineEfficiencyFactors(): { multiplier: number; threshold: number } {
    return { multiplier: javaFloat(0.5), threshold: javaFloat(0.75) };
  }
}
