/**
 * LegacyNCPF **v10** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF10Reader.java`
 * (132 lines; bare `:NNN` references below are to that frozen file).
 *
 * v10 differs from v11 only in its *placement rule* encoding, so this class
 * mirrors exactly the parts of the Java subclass: the four overrides
 * ({@link getTargetVersion}, `readRuleBlock`, `readRuleBlockType`,
 * `readGenericRule`) plus the two rule-type tables it switches between
 * (`mapRuleTypeNcpf10` for every configuration but the turbine,
 * `mapTurbineRuleTypeNcpf10` for `nuclearcraft:overhaul_turbine` — `:93` compares
 * the `blockTypes` array *by identity*, and the turbine is the only configuration
 * with its own table; here that is the configuration key the v11 reader's rule
 * state carries, which is the same distinction):
 *
 *  - `readRuleBlock` stores the target index as a **byte** (`:82`);
 *  - `readRuleBlockType` reads its `blockTypes` index from `block`, not
 *    `blockType` (`:87`);
 *  - `readGenericRule` never consults `isSpecificBlock`: v10 spells the rule kind
 *    out in the type byte (the `*_GROUP` constants at `:22-25`), so a "block" rule
 *    always resolves through the post-load index and a "group" rule always
 *    resolves through `blockTypes`.
 *
 * The v10 type byte numbering is *not* v11's: v11's table is
 * `[between, axial, vertex, edge, or, and]` while v10 inserts three group kinds
 * before `or`/`and`, and numbers `vertex` before `edge` for everything except
 * the turbine (where `edge` takes the `2` slot that `vertex` has elsewhere).
 *
 * Oracle coverage: `historical/e2e.ncpf` and `historical/po3.ncpf` exercise both
 * the index ("block") and the group ("blockTypes") rule paths, plus `OR`/`AND`
 * nesting, and reproduce `datasets/converted/ncpf/*` byte-for-byte. The other
 * four v10 fixtures (`ic2`, `trinity`, `extreme_reactors`, `aop-v10`) have no
 * rules, and **no** v10 fixture has a turbine rule, so
 * {@link mapTurbineRuleType} is mirrored from the Java table but not pinned by a
 * golden. Two Java quirks are kept as written:
 *
 *  - a v10 block rule index is read with `getByte`, so a file holding an `int`
 *    there throws a `ClassCastException` in Java; `config2.ts` does not track
 *    byte-ness, so this port reads it the same permissive way as v11;
 *  - `readGenericRule` ends with `rule.setReferences(null, false)` for *every*
 *    kind (v11 only does it inside `readRuleTarget`). That call only rewrites the
 *    reference type of a module target and recurses into sub-rules that already
 *    did it, so it is not observable in the serialised tree and is not modelled —
 *    same treatment as the v11 port.
 */
import { ConfigObject } from '../config2.js';
import type { JsonObject } from '../json.js';
import { LegacyFormatError } from './types.js';
import { LegacyNCPF11Reader, type RuleState } from './ncpf11.js';

/** The configuration whose rule bytes are numbered by the turbine table (`:93`). */
const TURBINE_CONFIG = 'nuclearcraft:overhaul_turbine';

/** The `NCPFPlacementRule.RuleType` names this reader writes into the JSON. */
type RuleName = 'between' | 'axial' | 'vertex' | 'edge' | 'or' | 'and';

/** Java `LegacyRuleType` (`:17-34`). */
type LegacyRuleType =
  | 'BETWEEN'
  | 'AXIAL'
  | 'EDGE'
  | 'VERTEX'
  | 'BETWEEN_GROUP'
  | 'AXIAL_GROUP'
  | 'EDGE_GROUP'
  | 'VERTEX_GROUP'
  | 'OR'
  | 'AND';

/** `LegacyRuleType.currentRule` (`:29-33`) — a `*_GROUP` alias is the plain kind. */
const CURRENT_RULE: Readonly<Record<LegacyRuleType, RuleName>> = {
  BETWEEN: 'between',
  AXIAL: 'axial',
  EDGE: 'edge',
  VERTEX: 'vertex',
  BETWEEN_GROUP: 'between',
  AXIAL_GROUP: 'axial',
  EDGE_GROUP: 'edge',
  VERTEX_GROUP: 'vertex',
  OR: 'or',
  AND: 'and',
};

/** Java `mapRuleTypeNcpf10` (`:36-57`). */
function mapRuleType(typeByte: number): LegacyRuleType {
  switch (typeByte) {
    case 0:
      return 'BETWEEN';
    case 1:
      return 'AXIAL';
    case 2:
      return 'VERTEX';
    case 3:
      return 'BETWEEN_GROUP';
    case 4:
      return 'AXIAL_GROUP';
    case 5:
      return 'VERTEX_GROUP';
    case 6:
      return 'OR';
    case 7:
      return 'AND';
    default:
      throw new LegacyFormatError(`Found rule with invalid type: ${typeByte}`);
  }
}

/** Java `mapTurbineRuleTypeNcpf10` (`:58-79`) — `EDGE` where the other table has `VERTEX`. */
function mapTurbineRuleType(typeByte: number): LegacyRuleType {
  switch (typeByte) {
    case 0:
      return 'BETWEEN';
    case 1:
      return 'AXIAL';
    case 2:
      return 'EDGE';
    case 3:
      return 'BETWEEN_GROUP';
    case 4:
      return 'AXIAL_GROUP';
    case 5:
      return 'EDGE_GROUP';
    case 6:
      return 'OR';
    case 7:
      return 'AND';
    default:
      throw new LegacyFormatError(`Found rule with invalid type: ${typeByte}`);
  }
}

/** Java `Config.get("rules")` on an `OR`/`AND` rule (`:117`, `:123`). */
function readRuleList(ruleCfg: ConfigObject): ConfigObject[] {
  const rules = ruleCfg.getList('rules');
  if (rules === null) throw new LegacyFormatError('config2: "rules" is not a list');
  return rules.items.map((item, index) => {
    if (!(item instanceof ConfigObject)) throw new LegacyFormatError(`config2: "rules"[${index}] is not a config`);
    return item;
  });
}

/** LegacyNCPF v10 reader — v11 with the v10 placement-rule encoding. */
export class LegacyNCPF10Reader extends LegacyNCPF11Reader {
  override readonly name: string = 'LegacyNCPF10Reader';
  /** Mirrors `FileReader.formats`: v11 (`order = 1`) is tried first. */
  override readonly order: number = 2;

  /** Java `getTargetVersion` (`:12-15`). */
  protected override getTargetVersion(): number {
    return 10;
  }

  /** Java `readRuleBlock` (`:80-84`) — the target index is a byte. */
  protected override readRuleBlock(
    state: RuleState,
    rule: JsonObject,
    ruleCfg: ConfigObject,
    blockName: string,
  ): void {
    state.postLoad.set(rule, ruleCfg.getByte('block'));
    state.postNames.set(rule, blockName);
  }

  /** Java `readRuleBlockType` (`:86-88`) — the `blockTypes` index lives under `block`. */
  protected override readRuleBlockType(state: RuleState, rule: JsonObject, ruleCfg: ConfigObject): void {
    const index = ruleCfg.getByte('block');
    const name: string | undefined = state.blockTypes[index];
    if (name === undefined) throw new LegacyFormatError(`Invalid block type index: ${index}!`);
    // `rule.target = new NCPFModuleReference(blockTypes[index])`.
    rule.block = { type: 'module', name };
  }

  /** Java `readGenericRule` (`:89-131`) — no `isSpecificBlock`; the type byte picks the kind. */
  protected override readGenericRule(state: RuleState, ruleCfg: ConfigObject, blockName: string): JsonObject {
    const rule: JsonObject = {};
    const typeByte = ruleCfg.getByte('type');
    const ruleType =
      state.blockConfig === TURBINE_CONFIG ? mapTurbineRuleType(typeByte) : mapRuleType(typeByte);
    rule.type = CURRENT_RULE[ruleType];
    switch (ruleType) {
      case 'BETWEEN':
      case 'AXIAL':
        this.readRuleBlock(state, rule, ruleCfg, blockName);
        rule.min = ruleCfg.getByte('min');
        rule.max = ruleCfg.getByte('max');
        break;
      case 'VERTEX':
      case 'EDGE':
        this.readRuleBlock(state, rule, ruleCfg, blockName);
        break;
      case 'BETWEEN_GROUP':
      case 'AXIAL_GROUP':
        this.readRuleBlockType(state, rule, ruleCfg);
        rule.min = ruleCfg.getByte('min');
        rule.max = ruleCfg.getByte('max');
        break;
      case 'EDGE_GROUP':
      case 'VERTEX_GROUP':
        this.readRuleBlockType(state, rule, ruleCfg);
        break;
      case 'OR':
      case 'AND':
        rule.rules = readRuleList(ruleCfg).map((sub) => this.readGenericRule(state, sub, blockName));
        break;
    }
    // `rule.setReferences(null, false)` only rewrites the reference *type*, which
    // the serialised definition does not carry — see `readRuleTarget` in ncpf11.ts.
    return rule;
  }
}
