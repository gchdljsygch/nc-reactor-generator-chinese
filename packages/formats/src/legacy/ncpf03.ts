/**
 * LegacyNCPF **v3** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF3Reader.java`.
 *
 * Up to v4 a turbine blade's "is this a stator?" flag was a stored boolean; in
 * NCPF 3 and earlier it was derived from the `expansion` field: a blade that
 * *reduces* the expansion ratio is a stator. Everything else is v4.
 */
import { ConfigObject } from '../config2.js';
import { LegacyNCPF4Reader } from './ncpf04.js';

/** LegacyNCPF v3 — stators are blades with `expansion < 1`. */
export class LegacyNCPF3Reader extends LegacyNCPF4Reader {
  override readonly name: string = 'LegacyNCPF3Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 9;

  /** Java `getTargetVersion` (`:7-9`). */
  protected override getTargetVersion(): number {
    return 3;
  }

  /** Java `readBladeStator` (`:10-13`) — `config.getFloat("expansion") < 1`. */
  protected override readBladeStator(config: ConfigObject, name: string): boolean {
    return config.getFloat('expansion') < 1;
  }
}
