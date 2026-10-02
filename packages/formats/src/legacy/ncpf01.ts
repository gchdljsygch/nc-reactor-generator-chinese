/**
 * LegacyNCPF **v1** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF1Reader.java`.
 *
 * The oldest reader of the chain, and the smallest: MSR reactors did not exist
 * in NCPF 1 (`:40-43`), so the dispatcher stops at id 1 and the MSR loader is a
 * no-op. Everything else — including the v2 composite rule encoding — is
 * inherited from v2.
 *
 * Both v1 fixtures (`historical/asdf.ncpf`, `historical/qwerty.ncpf`) do contain
 * an `overhaul` section, but with no MSR configuration, so the no-op loader is
 * what makes their `overhaul.fissionSFR` readable.
 */
import type { JsonObject } from '../json.js';
import { ConfigObject } from '../config2.js';
import { LegacyFormatError } from './types.js';
import { LegacyNCPF2Reader } from './ncpf02.js';
import type { ProjectJson } from './ncpf11.js';

/** LegacyNCPF v1 — v2 without the MSR multiblock. */
export class LegacyNCPF1Reader extends LegacyNCPF2Reader {
  override readonly name: string = 'LegacyNCPF1Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 11;

  /** Java `getTargetVersion` (`:12-15`). */
  protected override getTargetVersion(): number {
    return 1;
  }

  /** Java `readMultiblock` (`:16-39`) — ids 0…1 only. */
  protected override readMultiblock(project: ProjectJson, data: ConfigObject): JsonObject {
    const id = data.getInt('id');
    if (id < 0 || id > 1) throw new LegacyFormatError(`Unknown Multiblock ID: ${id}`);
    return super.readMultiblock(project, data);
  }

  /** Java `loadOverhaulMSRBlocks` (`:40-43`) — MSR reactors did not exist in NCPF 1. */
  protected override loadOverhaulMSRBlocks(
    parent: Map<string, JsonObject> | null,
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
    loadingAddon: boolean,
    isAddon: boolean,
    additionalBlocks: JsonObject[],
  ): void {
    // MSR reactors did not exist in NCPF 1
  }
}
