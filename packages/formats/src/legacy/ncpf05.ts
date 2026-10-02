/**
 * LegacyNCPF **v5** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF5Reader.java`.
 *
 * One line of behaviour: the output ratio of a turbine blade/recipe was stored
 * as an integer in NCPF 5 and earlier, and as a float from v6 on. Everything
 * else is inherited from v6.
 */
import { ConfigObject } from '../config2.js';
import { LegacyNCPF6Reader } from './ncpf06.js';

/** LegacyNCPF v5 — integer output ratios. */
export class LegacyNCPF5Reader extends LegacyNCPF6Reader {
  override readonly name: string = 'LegacyNCPF5Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 7;

  /** Java `getTargetVersion` (`:5-8`). */
  protected override getTargetVersion(): number {
    return 5;
  }

  /** Java `readOutputRatio` (`:10-13`) — `config.getInt(name)`, without a default. */
  protected override readOutputRatio(config: ConfigObject, name: string): number {
    return config.getInt(name);
  }
}
