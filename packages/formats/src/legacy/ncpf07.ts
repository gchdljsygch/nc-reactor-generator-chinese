/**
 * LegacyNCPF **v7** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF7Reader.java`.
 *
 * Two overrides: the version byte and the multiblock dispatcher, which stops at
 * id 3 because **fusion did not exist in NCPF 7** (`:45-46`) — the fusion loader
 * is a no-op and id 4 is therefore an unknown multiblock. The dispatcher's body
 * is otherwise identical to the inherited one (same four readers, same
 * `metadata` merge, same `Unknown Multiblock ID` default), so the port rejects
 * the ids the parent would have accepted and defers to `super`.
 */
import type { JsonObject } from '../json.js';
import { ConfigObject } from '../config2.js';
import { LegacyFormatError } from './types.js';
import { LegacyNCPF8Reader } from './ncpf08.js';
import type { ProjectJson } from './ncpf11.js';

/** LegacyNCPF v7 — v8 without fusion multiblocks. */
export class LegacyNCPF7Reader extends LegacyNCPF8Reader {
  override readonly name: string = 'LegacyNCPF7Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 5;

  /** Java `getTargetVersion` (`:9-12`). */
  protected override getTargetVersion(): number {
    return 7;
  }

  /** Java `readMultiblock` (`:13-42`) — ids 0…3 only. */
  protected override readMultiblock(project: ProjectJson, data: ConfigObject): JsonObject {
    const id = data.getInt('id');
    if (id < 0 || id > 3) throw new LegacyFormatError(`Unknown Multiblock ID: ${id}`);
    return super.readMultiblock(project, data);
  }

  /** Java `loadOverhaulFusionGeneratorBlocks` (`:43-46`) — fusion did not exist. */
  protected override loadOverhaulFusionGeneratorBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    // fusion did not exist in NCPF 7
  }
}
