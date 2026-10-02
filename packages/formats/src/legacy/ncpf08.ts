/**
 * LegacyNCPF **v8** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF8Reader.java`.
 *
 * The whole class is three overrides: the version byte and the two reactor I/O
 * rate hooks. v9 declares `parseInputRate` / `parseOutputRate` but never calls
 * them; v8 is the version that changed their meaning from "read a rate field" to
 * "a block that has any `input`/`output` port at all is worth 1". Nothing in the
 * chain calls them either, so this file exists only to keep the version chain
 * (and therefore `matches()`) exact — the golden run never reaches the hook.
 */
import { ConfigObject } from '../config2.js';
import { LegacyNCPF9Reader } from './ncpf09.js';

/** LegacyNCPF v8 — v9 with boolean reactor I/O ports. */
export class LegacyNCPF8Reader extends LegacyNCPF9Reader {
  override readonly name: string = 'LegacyNCPF8Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 4;

  /** Java `getTargetVersion` (`:5-8`). */
  protected override getTargetVersion(): number {
    return 8;
  }

  /** Java `parseInputRate` (`:10-13`). */
  protected override parseInputRate(blockCfg: ConfigObject): number {
    return blockCfg.hasProperty('input') ? 1 : 0;
  }

  /** Java `parseOutputRate` (`:14-17`). */
  protected override parseOutputRate(blockCfg: ConfigObject): number {
    return blockCfg.hasProperty('output') ? 1 : 0;
  }
}
