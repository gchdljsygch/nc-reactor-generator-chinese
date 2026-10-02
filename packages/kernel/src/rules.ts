import { COMMON_MODULE, hasModule, type NCPFElementDefinition, type PlacementRule, type RuleTarget } from '@ncplanner/ncpf';
import { AXES, DIRECTION_VECTORS, EDGES, VERTICES, offsetDir, type Pos } from './geometry.js';

/**
 * `NCPFPlacementRule.isValid` — shared by every reactor type's heat sinks,
 * coolers and turbines. Parameterised over the block representation so SFR,
 * Underhaul SFR, MSR and Turbine all use one implementation (iron law: one
 * implementation per concept).
 */
export interface RuleBlock {
  readonly pos: Pos;
  readonly definition: NCPFElementDefinition;
  readonly modules: Parameters<typeof hasModule>[0];
  isActive(): boolean;
}

export interface RuleGrid<B extends RuleBlock> {
  contains(p: Pos): boolean;
  blockAt(p: Pos): B | null | undefined;
}

export function targetMatches<B extends RuleBlock>(target: RuleTarget, block: B | null): boolean {
  if (target.kind === 'module') {
    if (target.name === COMMON_MODULE.air) return block === null;
    return block !== null && hasModule(block.modules, target.name);
  }
  if (block === null) return false;
  // Java `NCPFSettingsElement.matches` compares every declared field, which for
  // the definitions used in reactor rules is definition equality.
  return block.definition.identity === target.definition.identity && block.definition.type === target.definition.type;
}

function isAirTarget(target: RuleTarget | undefined): boolean {
  return target?.kind === 'module' && target.name === COMMON_MODULE.air;
}

export function placementRuleIsValid<B extends RuleBlock>(
  rule: PlacementRule,
  block: B,
  grid: RuleGrid<B>,
): boolean {
  let num = 0;
  const air = isAirTarget(rule.target);
  switch (rule.rule) {
    case 'between': {
      if (air) {
        num = 6 - adjacent(block, grid).length;
      } else {
        for (const b of activeAdjacent(block, grid)) {
          if (rule.target && targetMatches(rule.target, b)) num++;
        }
      }
      return num >= rule.min && num <= rule.max;
    }
    case 'axial': {
      for (const axis of AXES) {
        const p1 = offsetDir(block.pos, axis, -1);
        const p2 = offsetDir(block.pos, axis, 1);
        if (!grid.contains(p1)) continue;
        if (!grid.contains(p2)) continue;
        const b1 = grid.blockAt(p1) ?? null;
        const b2 = grid.blockAt(p2) ?? null;
        if (air) {
          if (b1 === null && b2 === null) num++;
        } else {
          if (b1 === null || b2 === null) continue;
          if (!b1.isActive() || !b2.isActive()) continue;
          if (rule.target && targetMatches(rule.target, b1) && targetMatches(rule.target, b2)) num++;
        }
      }
      return num >= rule.min && num <= rule.max;
    }
    case 'vertex':
    case 'edge': {
      const dirs = new Array<boolean>(6).fill(false);
      for (let idx = 0; idx < DIRECTION_VECTORS.length; idx++) {
        const p = offsetDir(block.pos, DIRECTION_VECTORS[idx]);
        if (!grid.contains(p)) continue;
        const b = grid.blockAt(p) ?? null;
        if (air) {
          if (b === null) dirs[idx] = true;
        } else if (b !== null && b.isActive() && rule.target && targetMatches(rule.target, b)) {
          dirs[idx] = true;
        }
      }
      const sets: readonly (readonly number[])[] = rule.rule === 'vertex' ? VERTICES : EDGES;
      for (const set of sets) {
        let all = true;
        for (const idx of set) {
          if (!dirs[idx]) {
            all = false;
            break;
          }
        }
        if (all) return true;
      }
      return false;
    }
    case 'and': {
      for (const r of rule.rules) if (!placementRuleIsValid(r, block, grid)) return false;
      return true;
    }
    case 'or': {
      for (const r of rule.rules) if (placementRuleIsValid(r, block, grid)) return true;
      return false;
    }
    default:
      throw new Error(`Unknown placement rule type: ${String(rule.rule)}`);
  }
}

function adjacent<B extends RuleBlock>(block: B, grid: RuleGrid<B>): B[] {
  const out: B[] = [];
  for (const d of DIRECTION_VECTORS) {
    const p = offsetDir(block.pos, d);
    if (!grid.contains(p)) continue;
    const b = grid.blockAt(p) ?? null;
    if (b !== null) out.push(b);
  }
  return out;
}

function activeAdjacent<B extends RuleBlock>(block: B, grid: RuleGrid<B>): B[] {
  const out: B[] = [];
  for (const d of DIRECTION_VECTORS) {
    const p = offsetDir(block.pos, d);
    if (!grid.contains(p)) continue;
    const b = grid.blockAt(p) ?? null;
    if (b !== null && b.isActive()) out.push(b);
  }
  return out;
}
