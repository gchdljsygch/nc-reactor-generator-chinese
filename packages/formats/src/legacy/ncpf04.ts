/**
 * LegacyNCPF **v4** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF4Reader.java`.
 *
 * v4 is the last version whose multiblock layout is the v9/v11 one; from v3 down
 * the readers override individual loaders or the dispatcher instead. What makes
 * v4 special is that it is the **only** reader in the chain that forks
 * `loadConfiguration` (`:23-123`) instead of inheriting v11's, and the fork has
 * a different header contract:
 *
 *   - `boolean addon = false;` (`:29`) — v4 predates the `addon` flag, so the
 *     key is *not* read. Every `*-v1`/`*-v2` fixture in
 *     `datasets/converted/MANIFEST.json` omits `addon`, which is why v9…v11's
 *     `config.getBoolean("addon")` (`ncpf11.ts:972`) fails on them.
 *   - `loadSettings` is unconditionally `true` (`:30`, `:35-37`); there is no
 *     `partial` gate and no fusion loader ("fusion did not exist in NCPF 4").
 *   - Metadata is set on four configurations, not five.
 *   - `project.conglomerate()` is called *before* the placement-rule fixups and
 *     *before* the active-cooler merge (`:64`), not after them.
 *
 * ## Deliberate deviations from the frozen reader
 *
 *  1. **The five rule maps are not cleared.** v11 clears them at the top of its
 *     `loadConfiguration` (`LegacyNCPF11Reader.java:432-437`); the v4 fork does
 *     not, so a shared reader instance leaks indexed rules from the previously
 *     read file into the next one. The registry hands out one instance per
 *     version and `readAnyProjectBytes` reads the fixtures in sequence, so the
 *     port clears them (`this.clearRuleState()`). This is the same fix the
 *     v11 port documents at its declaration.
 *  2. **The second active-cooler merge is not ported** (`:111-122`). Java walks
 *     the *conglomeration*'s underhaul blocks (`project.getConfiguration`, i.e.
 *     `conglomeration`, `Project.java:52-53`) after having merged the main
 *     configuration's; the port computes the conglomeration on demand
 *     (`conglomerate()`), so there is no second list to merge. For a file
 *     without addons — every v1…v4 fixture — the two lists hold the same blocks
 *     and the second pass is a no-op.
 *  3. **`propagateRecipePortRecipes` is not called** — recipe ports arrived with
 *     v11, and no v4 configuration can carry a `recipe_ports` module.
 */
import type { JsonObject } from '../json.js';
import { ConfigObject } from '../config2.js';
import { LegacyNCPF5Reader } from './ncpf05.js';
import {
  elementList,
  requireList,
  requireObject,
  setConfigurationMetadata,
  withConfiguration,
  type ProjectJson,
} from './ncpf11.js';

/** The configuration keys the v4 fork touches (`ncpf11.ts` keeps its copies private). */
const UH = 'nuclearcraft:underhaul_sfr';
const SFR = 'nuclearcraft:overhaul_sfr';
const MSR = 'nuclearcraft:overhaul_msr';
const TURBINE = 'nuclearcraft:overhaul_turbine';

/** LegacyNCPF v4 — v5 with its own `loadConfiguration`. */
export class LegacyNCPF4Reader extends LegacyNCPF5Reader {
  override readonly name: string = 'LegacyNCPF4Reader';
  /** Mirrors `FileReader.formats`. */
  override readonly order: number = 8;

  /** Java `getTargetVersion` (`:18-21`). */
  protected override getTargetVersion(): number {
    return 4;
  }

  /** Java `loadConfiguration` (`:23-123`). */
  protected override loadConfiguration(project: ProjectJson, config: ConfigObject): void {
    this.clearRuleState(); // deviation 1
    const name = config.getString('name');
    const version = config.getString('version');
    const underhaulVersion = config.getString('underhaulVersion');
    // `boolean addon = false;` — never read from the file (`:29`).
    const addon = false;

    this.loadUnderhaulBlocks(project.configuration, config, true);
    const sfrAdditional: JsonObject[] = [];
    const msrAdditional: JsonObject[] = [];
    if (config.hasProperty('overhaul')) {
      const overhaul = requireObject(config, 'overhaul');
      this.loadOverhaulSFRBlocks(null, project.configuration, overhaul, true, false, addon, sfrAdditional);
      this.loadOverhaulMSRBlocks(null, project.configuration, overhaul, true, false, addon, msrAdditional);
      this.loadOverhaulTurbineBlocks(project.configuration, overhaul, true);
      // fusion did not exist in NCPF 4
    }
    withConfiguration(project.configuration, UH, (cfg) => setConfigurationMetadata(cfg, name, underhaulVersion));
    withConfiguration(project.configuration, SFR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(project.configuration, MSR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(project.configuration, TURBINE, (cfg) => setConfigurationMetadata(cfg, name, version));

    if (config.hasProperty('addons')) {
      for (const addonConfig of requireList(config, 'addons')) {
        project.addons.push(this.loadAddon(project, addonConfig));
      }
    }
    if (sfrAdditional.length > 0) elementList(project.configuration.get(SFR)!, 'blocks').push(...sfrAdditional);
    if (msrAdditional.length > 0) elementList(project.configuration.get(MSR)!, 'blocks').push(...msrAdditional);

    // `project.conglomerate()` then the four post-load loops and the active-cooler
    // merge (`:64-122`). The indexed rules live in the same five maps v11 uses and
    // the index-0 targets are identical (Air, except the turbine's casing), so the
    // inherited resolution is exact.
    this.resolvePostLoadRules(project);
    this.combineActiveCoolers(project); // deviations 2 and 3
  }
}
