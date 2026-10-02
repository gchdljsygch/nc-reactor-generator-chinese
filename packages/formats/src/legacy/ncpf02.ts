/**
 * LegacyNCPF **v2** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF2Reader.java`.
 *
 * Three things changed in v2 relative to v3:
 *
 *  1. **Turbines did not exist** (`:47-50`), so the dispatcher stops at id 2 and
 *     `loadOverhaulTurbineBlocks` is a no-op. (v3…v7 get the turbine loader from
 *     v9; only v1 and v2 reject it.)
 *  2. **Placement rules use a completely different encoding**
 *     (`readGenericRuleNcpf2`, `:52-108`): a single type byte picks block-vs-block
 *     type, and types 4…6 build composite rules inline. Types 2 and 3 are the
 *     *same* kinds as 0 and 1 (`BETWEEN`/`AXIAL`) but reference a block **type**
 *     instead of a block index.
 *  3. The per-configuration rule maps are handed to that method directly instead
 *     of going through v11's `readGenericRule`, so all three rule readers are
 *     overridden (`:110-124`) — the turbine and fusion ones are not, because
 *     neither configuration can be loaded by this reader.
 *
 * The composite kind (type 4) is the only place the NCPF 2 format names a
 * casing: `AND[ VERTEX casing, BETWEEN casing 3…3 ]` — i.e. "the block is a
 * vertex of the casing shell, and exactly three casing blocks away".
 */
import type { JsonObject } from '../json.js';
import { ConfigObject } from '../config2.js';
import { LegacyFormatError } from './types.js';
import { LegacyNCPF3Reader } from './ncpf03.js';
import { requireList, type ProjectJson, type RuleState } from './ncpf11.js';

/** Configuration keys and the casing module the composite rule names. */
const UH = 'nuclearcraft:underhaul_sfr';
const SFR = 'nuclearcraft:overhaul_sfr';
const MSR = 'nuclearcraft:overhaul_msr';

/** `NCPFModuleReference` for a module name — `moduleDefinition` in `ncpf11.ts`. */
function moduleReference(name: string): JsonObject {
  return { type: 'module', name };
}

/** LegacyNCPF v2 — block-type rules, no turbines, composite rule kinds. */
export class LegacyNCPF2Reader extends LegacyNCPF3Reader {
  override readonly name: string = 'LegacyNCPF2Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 10;

  /** Java `getTargetVersion` (`:15-18`). */
  protected override getTargetVersion(): number {
    return 2;
  }

  /** Java `readMultiblock` (`:19-45`) — ids 0…2 only. */
  protected override readMultiblock(project: ProjectJson, data: ConfigObject): JsonObject {
    const id = data.getInt('id');
    if (id < 0 || id > 2) throw new LegacyFormatError(`Unknown Multiblock ID: ${id}`);
    return super.readMultiblock(project, data);
  }

  /** Java `loadOverhaulTurbineBlocks` (`:47-50`) — turbines did not exist in NCPF 2. */
  protected override loadOverhaulTurbineBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    // turbines did not exist in NCPF 2
  }

  /**
   * Java `readGenericRuleNcpf2` (`:52-108`). The Java switch has no `default`, so
   * an unknown type byte leaves `rule.rule` at its initial `null` and the failure
   * only surfaces when the design is serialised (`NCPFPlacementRule.convertToObject`
   * dereferences it). Like v10's reader — which reports the same condition with
   * the same message — this port fails at the rule instead.
   */
  protected readGenericRuleNcpf2(
    state: RuleState,
    casing: string,
    ruleCfg: ConfigObject,
    blockName: string,
  ): JsonObject {
    const rule: JsonObject = {};
    const type = ruleCfg.getByte('type');
    switch (type) {
      case 0:
      case 1:
        rule.type = type === 0 ? 'between' : 'axial';
        this.readRuleBlock(state, rule, ruleCfg, blockName);
        rule.min = ruleCfg.getByte('min');
        rule.max = ruleCfg.getByte('max');
        break;
      case 2:
      case 3:
        rule.type = type === 2 ? 'between' : 'axial';
        this.readRuleBlockType(state, rule, ruleCfg);
        rule.min = ruleCfg.getByte('min');
        rule.max = ruleCfg.getByte('max');
        break;
      case 4: {
        rule.type = 'and';
        const vertex: JsonObject = { type: 'vertex', block: moduleReference(casing) };
        const exact: JsonObject = { type: 'between', block: moduleReference(casing), min: 3, max: 3 };
        rule.rules = [vertex, exact];
        break;
      }
      case 5:
      case 6:
        rule.type = type === 5 ? 'or' : 'and';
        rule.rules = requireList(ruleCfg, 'rules').map((sub) =>
          this.readGenericRuleNcpf2(state, casing, sub, blockName),
        );
        break;
      default:
        throw new LegacyFormatError(`Found rule with invalid type: ${type}`);
    }
    return rule;
  }

  /** Java `readUnderRule` (`:110-114`). */
  protected override readUnderRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRuleNcpf2(this.rules[UH]!, `${UH}:casing`, ruleCfg, blockName);
  }

  /** Java `readOverSFRRule` (`:115-119`). */
  protected override readOverSFRRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRuleNcpf2(this.rules[SFR]!, `${SFR}:casing`, ruleCfg, blockName);
  }

  /** Java `readOverMSRRule` (`:120-124`). */
  protected override readOverMSRRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRuleNcpf2(this.rules[MSR]!, `${MSR}:casing`, ruleCfg, blockName);
  }
}
